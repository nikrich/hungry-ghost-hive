/**
 * Timeout and retry utilities for LLM calls
 */

export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Wraps a promise with a timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${errorMessage} after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Retries a function with exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelayMs = 1000, maxDelayMs = 30000 } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxRetries) break;

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5),
        maxDelayMs
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Combines timeout and retry logic
 */
export async function withTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retryOptions: RetryOptions,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return withRetry(() => withTimeout(fn(), timeoutMs, errorMessage), retryOptions);
}
