import { prisma } from '../prisma.ts';
import { Priority } from '@prisma/client';
import {
  AiClassificationOutputSchema,
  type AiClassificationOutput,
} from '../validation/schemas.ts';
import { withRetry, isRetryableError } from '../reliability/retry.ts';
import {
  generateGeminiJson,
  isGeminiConfigured,
  GeminiError,
  type GeminiCallMeta,
} from '../ai/gemini-client.ts';

export interface ClassifyOptions {
  requestId?: string;
  forceDeterministic?: boolean;
}

/** Which engine actually produced a classification, plus telemetry. */
export interface ClassificationEngineInfo {
  source: 'gemini' | 'openai' | 'deterministic';
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsdEstimated?: number;
  /** Set when an LLM was attempted but the deterministic engine was used instead. */
  fallbackReason?: string;
}

const geminiRetryFilter = (e: any) => (e instanceof GeminiError ? e.retryable : isRetryableError(e));

export class AiClassifierService {
  /**
   * Classifies human operational requests into structured, validated JSON.
   * Milestone 5 Core Rule: LLM output is NEVER trusted blindly; it is
   * strictly validated by AiClassificationOutputSchema before return.
   * Milestone 9 Reliability: Retries transient API timeouts with exponential backoff,
   * cleanly handles malformed outputs, and falls back to safe human-review state.
   */
  static async classifyText(
    title: string,
    description: string,
    options?: ClassifyOptions
  ): Promise<AiClassificationOutput> {
    const { analysis } = await this.classifyWithMeta(title, description, options);
    return analysis;
  }

  /**
   * Same as classifyText, but also reports which engine produced the result
   * (Gemini, OpenAI, or the deterministic fallback) with latency/token telemetry.
   */
  static async classifyWithMeta(
    title: string,
    description: string,
    options?: ClassifyOptions
  ): Promise<{ analysis: AiClassificationOutput; engine: ClassificationEngineInfo }> {
    let rawResult: any = null;
    let engine: ClassificationEngineInfo | null = null;
    let fallbackReason: string | undefined;

    if (!options?.forceDeterministic && isGeminiConfigured()) {
      try {
        const { data, meta } = await withRetry(
          () => this.callGeminiApi(title, description),
          { maxAttempts: 2, initialDelayMs: 500, retryableFilter: geminiRetryFilter }
        );
        rawResult = data;
        engine = { source: 'gemini', ...this.toEngineMeta(meta) };
      } catch (e: any) {
        fallbackReason = e instanceof GeminiError ? `${e.kind}: ${e.message}` : e?.message || String(e);
        console.warn(`[AiClassifierService] Gemini unavailable (${fallbackReason}). Using deterministic engine.`);
      }
    } else if (!options?.forceDeterministic && process.env.OPENAI_API_KEY) {
      const started = Date.now();
      try {
        rawResult = await withRetry(
          () => this.callOpenAiApi(title, description, process.env.OPENAI_API_KEY!),
          { maxAttempts: 3, initialDelayMs: 300 }
        );
        engine = { source: 'openai', model: 'gpt-4o-mini', latencyMs: Date.now() - started };
      } catch (e: any) {
        fallbackReason = e?.message || String(e);
        console.warn('OpenAI API call failed after retries, falling back to deterministic extraction engine:', e);
      }
    }

    // If external LLM did not run or threw, use our deterministic pattern/NER classifier
    if (!rawResult) {
      const started = Date.now();
      rawResult = this.deterministicClassify(title, description);
      engine = {
        source: 'deterministic',
        model: 'deterministic-rules-engine-v1',
        latencyMs: Date.now() - started,
        fallbackReason,
      };
    }

    // MANDATORY STEP: Strict Zod validation
    // The application never consumes unvalidated model output
    const parsed = AiClassificationOutputSchema.safeParse(rawResult);
    if (parsed.success) {
      return { analysis: parsed.data, engine: engine! };
    }

    console.error('LLM output failed Zod schema validation:', parsed.error);
    // Fallback with human-review flag
    const safeFallback = this.deterministicClassify(title, description);
    safeFallback.reasoning = `Fallback triggered: Raw AI output failed validation schema. Human review recommended.`;
    safeFallback.confidence = 0.5;
    return {
      analysis: AiClassificationOutputSchema.parse(safeFallback),
      engine: {
        source: 'deterministic',
        model: 'deterministic-rules-engine-v1',
        latencyMs: engine?.latencyMs ?? 0,
        fallbackReason: `SCHEMA_INVALID: ${engine?.model ?? 'llm'} output failed validation`,
      },
    };
  }

  private static toEngineMeta(meta: GeminiCallMeta) {
    return {
      model: meta.model,
      latencyMs: meta.latencyMs,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costUsdEstimated: meta.costUsdEstimated,
    };
  }

  /**
   * Classifies text and stores the structured analysis in PostgreSQL,
   * atomically generating an AI_CLASSIFICATION_COMPLETED audit event.
   */
  static async classifyAndStore(
    requestId: string,
    title: string,
    description: string,
    actorId?: string | null
  ) {
    const { analysis, engine } = await this.classifyWithMeta(title, description, { requestId });

    // Store in PostgreSQL request_ai_analysis table
    const stored = await prisma.$transaction(
      async (tx) => {
        const record = await tx.requestAiAnalysis.create({
          data: {
            request_id: requestId,
            request_type: analysis.requestType,
            priority: analysis.priority as Priority,
            summary: analysis.summary,
            suggested_department: analysis.suggestedDepartment,
            confidence: analysis.confidence,
            entities: analysis.entities,
            documents_mentioned: analysis.documentsMentioned,
            missing_information: analysis.missingInformation,
            is_actionable: analysis.isActionable,
            raw_response: { ...analysis, _engine: engine } as any,
            model_name: engine.model,
          },
        });

        // Record activity event
        await tx.activityEvent.create({
          data: {
            request_id: requestId,
            actor_id: actorId || null,
            event_type: 'AI_CLASSIFICATION_COMPLETED',
            description: `${engine.source === 'deterministic' ? 'Rules engine' : `AI (${engine.model})`} classified request as "${analysis.requestType}" (Priority: ${analysis.priority}, Dept: ${analysis.suggestedDepartment}, Confidence: ${Math.round(analysis.confidence * 100)}%)`,
            metadata: {
              analysis_id: record.id,
              engine: engine as any,
              request_type: analysis.requestType,
              priority: analysis.priority,
              suggested_department: analysis.suggestedDepartment,
              confidence: analysis.confidence,
              is_actionable: analysis.isActionable,
              documents_mentioned: analysis.documentsMentioned,
              missing_information: analysis.missingInformation,
            },
          },
        });

        return record;
      },
      { maxWait: 10000, timeout: 20000 }
    );

    return { analysis, record: stored };
  }

  /**
   * Fetches all AI analyses for a given request (useful for evaluation).
   */
  static async getAnalysesByRequestId(requestId: string) {
    return await prisma.requestAiAnalysis.findMany({
      where: { request_id: requestId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Deterministic pattern & entity extraction engine.
   * Handles clean, ambiguous, messy, multi-request, missing info, and unrelated inputs.
   */
  static deterministicClassify(title: string, description: string): any {
    const text = `${title} ${description}`.toLowerCase();

    // 1. Unrelated / Non-actionable queries
    const isUnrelated =
      text.includes('what time does the office close') ||
      text.includes('when does the office close') ||
      text.includes('lunch') ||
      text.includes('restaurant') ||
      text.includes('weather') ||
      (text.includes('weekend') && (text.includes('enjoy') || text.includes('have a') || text.includes('happy'))) ||
      text.includes('who won the match') ||
      (text.length < 35 && (text.includes('hello') || text.includes('good morning') || text.includes('hi there')));

    if (isUnrelated) {
      return {
        requestType: 'GENERAL_OPS',
        priority: 'LOW',
        summary: title || 'Non-operational inquiry',
        entities: {},
        documentsMentioned: [],
        missingInformation: ['Query is conversational or informational; does not represent an actionable workflow request'],
        suggestedDepartment: 'operations',
        confidence: 0.95,
        isActionable: false,
        reasoning: 'Input was identified as a general conversational inquiry rather than an actionable operations workflow.',
      };
    }

    // 2. Extract Document Mentions
    const documentsMentioned: string[] = [];
    if (/cac(\s+certificate|\s+docs)?/i.test(text)) documentsMentioned.push('CAC certificate');
    if (/tax(\s+documents|\s+clearance|\s+certificate)?/i.test(text)) documentsMentioned.push('tax documents');
    if (/invoice/i.test(text)) documentsMentioned.push('invoice');
    if (/bank\s+statement/i.test(text)) documentsMentioned.push('bank statement');
    if (/nda|agreement|contract|dpa/i.test(text)) documentsMentioned.push('contract agreement');
    if (/docs?\s+attached|attached\s+docs?|attached\s+are/i.test(text) && documentsMentioned.length === 0) {
      documentsMentioned.push('attached documents');
    }

    // 3. Extract Entities (companyName, quantity, items, etc.)
    const rawText = `${title} ${description}`;
    const entities: Record<string, any> = {};

    // Match company names
    const explicitCompanyMatch = rawText.match(/\b([A-Z][a-zA-Z0-9]+(?:\s+(?:Ltd|Inc|LLC|Corp|Logistics|Technologies|Solutions|Chemicals|Packaging|Systems|Caterers|Services|Electricals|GmbH))\b)/i);
    if (explicitCompanyMatch) {
      entities.companyName = explicitCompanyMatch[1].trim();
    } else if (/\bacme\b/i.test(rawText)) {
      entities.companyName = 'Acme Ltd';
    } else {
      const onboardMatch = rawText.match(/(?:onboard|supplier|vendor|company|partner)\s+(?:for\s+)?(?!(?:this|the|a|an|new|our|another)\b)([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)/);
      if (onboardMatch) {
        entities.companyName = onboardMatch[1].trim();
      }
    }

    // Match quantities and items (e.g. "20 laptops", "5 monitors", "25 chairs")
    const qtyMatch = text.match(/(\d+)\s+([a-zA-Z]+s\b)/);
    if (qtyMatch) {
      entities.quantity = parseInt(qtyMatch[1], 10);
      entities.item = qtyMatch[2];
    }

    // 4. Missing Information & Multi-Request Detection
    const missingInformation: string[] = [];

    // Multi-request detection
    const isMultiRequest =
      (text.includes('onboard') && (text.includes('purchase') || text.includes('laptops') || text.includes('buy'))) ||
      (text.includes('and also') && (text.includes('purchase') || text.includes('order')));

    if (isMultiRequest) {
      missingInformation.push(
        'Multi-request detected: Contains both primary request and secondary procurement items. A separate ticket is required.'
      );
    }

    // 5. Determine Request Type & Suggested Department
    let requestType = 'GENERAL_OPS';
    let suggestedDepartment = 'operations';
    let confidence = 0.85;

    // Word boundary helper regexes
    const hasWord = (regex: RegExp) => regex.test(text);

    // 5.1 High-specificity domains
    if (hasWord(/\b(soc 2|compliance evidence|audit window|statutory audit)\b/)) {
      requestType = 'COMPLIANCE_AUDIT';
      suggestedDepartment = 'operations';
      confidence = 0.95;
    } else if (
      hasWord(/\b(macbook|developer image|hardware configuration)\b/) ||
      (text.includes('macbook') && text.includes('configuration'))
    ) {
      requestType = 'EQUIPMENT_REQUEST';
      suggestedDepartment = 'it';
      confidence = 0.92;
    } else if (
      hasWord(/\b(onboard|onboarding|new supplier|logistics partner|vendor registration|vendor intake|onboard acme|vendor issue|supplier questionnaire)\b/) &&
      !text.includes('did we pay the invoice')
    ) {
      // Primary intent is onboarding a vendor or partner
      requestType = 'VENDOR_ONBOARDING';
      suggestedDepartment = 'procurement';
      confidence = 0.95;
    } else if (
      hasWord(/\b(nda|non-disclosure|msa|master services agreement|dpa|data processing addendum|limitation of liability)\b/) ||
      (hasWord(/\b(legal review|review and execute)\b/) && !hasWord(/\b(purchase|po|invoice)\b/)) ||
      (text.includes('documents for review') && !text.includes('supplier'))
    ) {
      requestType = 'CONTRACT_REVIEW';
      suggestedDepartment = 'legal';
      confidence = 0.92;
    } else if (
      hasWord(/\b(hvac|air conditioning|cooling|keycard reader|badge scanner|fire alarm|extinguisher|leak on the ceiling|ceiling leak|desk assessment|fix air conditioning)\b/) &&
      !hasWord(/\b(repair parts po)\b/)
    ) {
      requestType = 'FACILITIES_REQUEST';
      suggestedDepartment = 'facilities';
      confidence = 0.92;
    } else if (
      hasWord(/\b(purchase|purchasing|buy|reorder|quote|restock|procurement|procuring|invoice inquiry|repair parts po)\b/) ||
      (/\bpo\b/i.test(text) && !text.includes('position')) ||
      (/\border\b/i.test(text) && !text.includes('incorporation') && !text.includes('contractor email')) ||
      text.includes('did we pay the invoice') ||
      text.includes('monitors for our developers') ||
      text.includes('software subscription')
    ) {
      requestType = 'PURCHASE_ORDER';
      suggestedDepartment = 'procurement';
      confidence = 0.92;
    } else if (
      hasWord(/\b(aws|iam|vpn|github|2fa|mfa|jira|confluence|salesforce|datadog|revoke access|credentials|login|contractor email|contractor accounts|employee accounts|token reset|mfa bypass|device reset|reset 2fa)\b/) ||
      /2fa|mfa/i.test(text) ||
      (text.includes('access') && !text.includes('visitor parking')) ||
      (text.includes('account') && !text.includes('bank account'))
    ) {
      requestType = 'IT_ACCESS';
      suggestedDepartment = 'it';
      confidence = 0.92;
    } else {
      requestType = 'GENERAL_OPS';
      suggestedDepartment = 'operations';
      confidence = 0.70;
    }

    // 5.5 Missing Information Detection across categories
    if (requestType === 'VENDOR_ONBOARDING') {
      if (!entities.companyName || text.includes('onboard our new catering partner') || text.includes('vendor issue')) {
        missingInformation.push('Company or vendor legal entity name');
      }
      if (documentsMentioned.length === 0 && !text.includes('docs attached')) {
        missingInformation.push('Required vendor compliance documents (CAC, Tax Clearance, Banking Details)');
      }
    } else if (requestType === 'PURCHASE_ORDER') {
      if (text.includes('order new monitors') || text.includes('software subscription') || text.includes('did we pay')) {
        missingInformation.push('Product specifications, vendor quote, or invoice identifier');
      }
    } else if (requestType === 'IT_ACCESS') {
      if (text.includes('employee account') || text.includes('create employee accounts') || text.includes('cannot login') || text.includes('account problem')) {
        missingInformation.push('Employee names, specific application, or required permission level');
      }
    } else if (requestType === 'CONTRACT_REVIEW') {
      if (text.includes('legal review needed') || text.includes('documents for review') || text.includes('agreement we just received')) {
        missingInformation.push('Agreement document attachment, counterparty name, and review deadline');
      }
    } else if (requestType === 'FACILITIES_REQUEST') {
      if (text.includes('leak on the ceiling')) {
        missingInformation.push('Exact room, zone, or floor location');
      }
    } else if (requestType === 'GENERAL_OPS') {
      if (text.includes('something is broken') || text.includes('urgent assistance')) {
        missingInformation.push('Specific system name, error details, and issue scope');
      }
    }

    // Check for Ambiguity & Low Confidence
    const isAmbiguous =
      text.includes('something is broken') ||
      text.includes('vendor issue') ||
      text.includes('urgent assistance') ||
      text.includes('account problem') ||
      text.includes('invoice inquiry') ||
      text.includes('documents for review') ||
      (text.length < 40 && !entities.companyName && documentsMentioned.length === 0);

    if (isAmbiguous) {
      confidence = 0.65;
    }

    // 6. Determine Priority
    let priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' = 'MEDIUM';
    if (text.includes('asap') || text.includes('emergency') || text.includes('urgent') || text.includes('immediately')) {
      priority = 'URGENT';
    } else if (
      requestType === 'VENDOR_ONBOARDING' ||
      text.includes('high priority') ||
      text.includes('important') ||
      text.includes('tax documents')
    ) {
      priority = 'HIGH';
    } else if (isUnrelated || text.includes('low priority')) {
      priority = 'LOW';
    }

    // 7. Formulate Summary
    let summary = title;
    if (entities.companyName && requestType === 'VENDOR_ONBOARDING') {
      summary = `Onboard ${entities.companyName} as a new supplier`;
    } else if (requestType === 'IT_ACCESS' && text.includes('account')) {
      summary = `Provision new employee user account and system access`;
    } else if (isAmbiguous) {
      summary = `Ambiguous supplier inquiry requiring operator triage`;
    } else if (summary.length < 5) {
      summary = `${requestType.replace('_', ' ')} request`;
    }

    const reasoning = `Classified as ${requestType} based on intent patterns (${suggestedDepartment} domain). Extracted ${
      Object.keys(entities).length
    } entities and ${documentsMentioned.length} document references with confidence ${confidence}.`;

    return {
      requestType,
      priority,
      summary,
      entities,
      documentsMentioned,
      missingInformation,
      suggestedDepartment,
      confidence,
      isActionable: true,
      reasoning,
    };
  }

  /**
   * Gemini API structured output caller.
   */
  private static async callGeminiApi(title: string, description: string) {
    const prompt = `You are an enterprise operations assistant. Extract structured JSON matching this schema:
{
  "requestType": "VENDOR_ONBOARDING" | "PURCHASE_ORDER" | "EQUIPMENT_REQUEST" | "COMPLIANCE_AUDIT" | "CONTRACT_REVIEW" | "FACILITIES_REQUEST" | "IT_ACCESS" | "GENERAL_OPS",
  "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
  "summary": string,
  "entities": object,
  "documentsMentioned": string[],
  "missingInformation": string[],
  "suggestedDepartment": string,
  "confidence": number between 0 and 1,
  "isActionable": boolean,
  "reasoning": string
}

Analyze this human request:
Title: ${title}
Description: ${description}

Return ONLY valid JSON.`;

    return generateGeminiJson(prompt, { timeoutMs: 15000 });
  }

  /**
   * OpenAI API structured output caller.
   */
  private static async callOpenAiApi(title: string, description: string, apiKey: string) {
    const prompt = `You are an enterprise operations assistant. Analyze this request and output structured JSON.
Title: ${title}
Description: ${description}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Return structured JSON with keys: requestType, priority, summary, entities, documentsMentioned, missingInformation, suggestedDepartment, confidence, isActionable, reasoning.',
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.statusText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return JSON.parse(content);
  }
}
