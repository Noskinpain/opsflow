/**
 * Milestone 9 — Reliability & Failure Handling: Retry Mechanism
 * Implements exponential backoff with jitter and strict error classification:
 * - 429 / timeout / temporary network error -> retry
 * - 401 unauthorized -> do NOT retry
 * - 400 invalid request / Zod schema failure -> do NOT retry
 * - invalid business state -> do NOT retry
 */

export interface RetryOptions {
  maxAttempts?: number;
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  retryableFilter?: (error: any) => boolean;
  onRetry?: (error: any, attempt: number, nextDelayMs: number) => void;
}

/**
 * Classifies whether an error represents a temporary/transient failure
 * eligible for automated retry.
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  // 1. Explicit retryable flag if set on custom error objects
  if (typeof error.isRetryable === 'boolean') {
    return error.isRetryable;
  }

  // 2. HTTP Status Code Classification
  const status = error.status || error.statusCode || error.response?.status;
  if (typeof status === 'number') {
    // 429 Too Many Requests -> RETRY
    if (status === 429) return true;
    // 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout -> RETRY
    if (status === 502 || status === 503 || status === 504) return true;
    // 400, 401, 403, 404, 422 -> PERMANENT, DO NOT RETRY
    if (status >= 400 && status < 500) return false;
  }

  // 3. Network & System Error Codes
  const code = error.code || error.cause?.code;
  if (typeof code === 'string') {
    const transientCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ];
    if (transientCodes.includes(code)) return true;
  }

  // 4. Timeouts & Abort signals
  const name = error.name || '';
  const message = (error.message || '').toLowerCase();
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network error') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  // 5. Database Transient Deadlocks & Connection Pool Timeouts
  if (
    message.includes('deadlock detected') ||
    message.includes('connection pool timeout') ||
    message.includes('can\'t reach database server') ||
    message.includes('terminating connection due to administrator command')
  ) {
    return true;
  }

  // 6. Non-retryable business validation / state machine errors
  if (
    name === 'ZodError' ||
    name === 'InvalidStateTransitionError' ||
    name === 'InvalidTaskTransitionError' ||
    name === 'ApprovalAlreadyDecidedError' ||
    name === 'UnauthorizedApproverError' ||
    name === 'NotFoundError' ||
    name === 'IncompleteTasksError' ||
    name === 'ClosedRequestModificationError' ||
    name === 'DuplicateAssignmentError' ||
    name === 'DuplicateTaskError'
  ) {
    return false;
  }

  // Default for unknown errors: do not blindly retry unless identified as transient
  return false;
}

/**
 * Executes an asynchronous function with exponential backoff and error classification.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? options.maxRetries ?? 3;
  const {
    initialDelayMs = 300,
    backoffFactor = 2,
    maxDelayMs = 5000,
    jitter = true,
    retryableFilter = isRetryableError,
    onRetry,
  } = options;

  let attempt = 1;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn(attempt);
    } catch (error: any) {
      if (attempt >= maxAttempts || !retryableFilter(error)) {
        throw error;
      }

      // Calculate exponential backoff delay with optional jitter
      let currentDelay = Math.min(delay, maxDelayMs);
      if (jitter) {
        // Random jitter between 80% and 120% of base delay
        currentDelay = Math.round(currentDelay * (0.8 + Math.random() * 0.4));
      }

      if (onRetry) {
        onRetry(error, attempt, currentDelay);
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelay));

      delay *= backoffFactor;
      attempt++;
    }
  }
}
