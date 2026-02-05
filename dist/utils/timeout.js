/**
 * Timeout and retry utilities for LLM calls
 */
export class TimeoutError extends Error {
    timeoutMs;
    constructor(message, timeoutMs) {
        super(message);
        this.timeoutMs = timeoutMs;
        this.name = 'TimeoutError';
    }
}
/**
 * Wraps a promise with a timeout
 */
export function withTimeout(promise, timeoutMs, errorMessage = 'Operation timed out') {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new TimeoutError(`${errorMessage} after ${timeoutMs}ms`, timeoutMs));
        }, timeoutMs);
        promise
            .then((result) => {
            clearTimeout(timer);
            resolve(result);
        })
            .catch((err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
/**
 * Retries a function with exponential backoff
 */
export async function withRetry(fn, options) {
    const { maxRetries, baseDelayMs = 1000, maxDelayMs = 30000 } = options;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt === maxRetries)
                break;
            const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5), maxDelayMs);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError || new Error('Max retries exceeded');
}
/**
 * Combines timeout and retry logic
 */
export async function withTimeoutAndRetry(fn, timeoutMs, retryOptions, errorMessage = 'Operation timed out') {
    return withRetry(() => withTimeout(fn(), timeoutMs, errorMessage), retryOptions);
}
//# sourceMappingURL=timeout.js.map