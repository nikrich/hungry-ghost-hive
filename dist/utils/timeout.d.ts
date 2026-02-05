/**
 * Timeout and retry utilities for LLM calls
 */
export declare class TimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(message: string, timeoutMs: number);
}
/**
 * Wraps a promise with a timeout. Rejects with TimeoutError if the promise
 * doesn't resolve within the specified time.
 */
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T>;
/**
 * Retry configuration options
 */
export interface RetryOptions {
    maxRetries: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (error: Error, attempt: number) => void;
}
/**
 * Wraps a function with retry logic using exponential backoff.
 * Will retry on any error up to maxRetries times.
 */
export declare function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
/**
 * Combines timeout and retry logic for LLM calls.
 * Each retry attempt has its own timeout.
 */
export declare function withTimeoutAndRetry<T>(fn: () => Promise<T>, timeoutMs: number, retryOptions: RetryOptions, errorMessage?: string): Promise<T>;
//# sourceMappingURL=timeout.d.ts.map