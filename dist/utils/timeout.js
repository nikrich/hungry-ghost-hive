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
 * Wraps a promise with a timeout. Rejects with TimeoutError if the promise
 * doesn't resolve within the specified time.
 */
export function withTimeout(promise, timeoutMs, errorMessage = 'Operation timed out') {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new TimeoutError(errorMessage, timeoutMs));
        }, timeoutMs);
        promise
            .then(value => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch(err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
/**
 * Wraps a function with retry logic using exponential backoff.
 * Will retry on any error up to maxRetries times.
 */
export async function withRetry(fn, options) {
    const { maxRetries, initialDelayMs = 1000, maxDelayMs = 60000, backoffMultiplier = 2, onRetry, } = options;
    let lastError = new Error('Retry failed');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                const delayMs = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
                if (onRetry) {
                    onRetry(lastError, attempt + 1);
                }
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
}
/**
 * Combines timeout and retry logic for LLM calls.
 * Each retry attempt has its own timeout.
 */
export async function withTimeoutAndRetry(fn, timeoutMs, retryOptions, errorMessage = 'Operation timed out') {
    return withRetry(() => withTimeout(fn(), timeoutMs, errorMessage), retryOptions);
}
//# sourceMappingURL=timeout.js.map