/**
 * Shared Gemini client.
 *
 * Centralises model selection, timeouts and telemetry so every AI feature
 * (classification, request interpretation, document extraction) behaves the
 * same way and reports the same metadata to the Workflow Inspector.
 *
 * Model choice: thinking-enabled models (gemini-3.8-flash, gemini-flash-latest)
 * took 40-60s per classification in testing. The lite model answers in ~1-2s
 * with equivalent accuracy for structured extraction, so it is the default.
 * Override with GEMINI_MODEL in .env.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

// Rough public pricing for lite-tier models (USD per 1M tokens). Used only for
// the cost estimate shown in the inspector, never for billing.
const INPUT_COST_PER_M = 0.1;
const OUTPUT_COST_PER_M = 0.4;

export interface GeminiCallMeta {
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsdEstimated: number;
}

export interface GeminiJsonResult<T = unknown> {
  data: T;
  meta: GeminiCallMeta;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly kind: 'NOT_CONFIGURED' | 'INVALID_KEY' | 'RATE_LIMITED' | 'TIMEOUT' | 'BAD_RESPONSE' | 'HTTP_ERROR'
  ) {
    super(message);
    this.name = 'GeminiError';
  }

  /** Transient failures are worth retrying; config/auth failures are not. */
  get retryable() {
    return this.kind === 'RATE_LIMITED' || this.kind === 'TIMEOUT' || (this.status !== null && this.status >= 500);
  }
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/**
 * Calls Gemini with JSON response mode and returns the parsed object plus
 * telemetry. Callers MUST still validate `data` with a Zod schema.
 */
export async function generateGeminiJson<T = unknown>(
  prompt: string,
  options: { timeoutMs?: number; temperature?: number } = {}
): Promise<GeminiJsonResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY is not set', null, 'NOT_CONFIGURED');
  }

  const model = getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const started = Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: options.temperature ?? 0.1,
        },
      }),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new GeminiError(`Gemini (${model}) timed out`, null, 'TIMEOUT');
    }
    throw new GeminiError(`Gemini network error: ${err?.message || err}`, null, 'HTTP_ERROR');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 400 && body.includes('API key not valid')) {
      throw new GeminiError('GEMINI_API_KEY was rejected by Google', 400, 'INVALID_KEY');
    }
    if (res.status === 429) {
      throw new GeminiError('Gemini rate limit reached', 429, 'RATE_LIMITED');
    }
    throw new GeminiError(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`, res.status, 'HTTP_ERROR');
  }

  const payload = await res.json();
  const text: string | undefined = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || 'empty response';
    throw new GeminiError(`Gemini returned no content (${reason})`, res.status, 'BAD_RESPONSE');
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new GeminiError('Gemini returned malformed JSON', res.status, 'BAD_RESPONSE');
  }

  const inputTokens = payload?.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = payload?.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    data,
    meta: {
      model,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
      costUsdEstimated: Number(
        ((inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000).toFixed(6)
      ),
    },
  };
}
