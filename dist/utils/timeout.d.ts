/**
 * Timeout and retry utilities for LLM calls
 */
export declare class TimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(message: string, timeoutMs: number);
}
export interface RetryOptions {
    maxRetries: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}
/**
 * Wraps a promise with a timeout
 */
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T>;
/**
 * Retries a function with exponential backoff
 */
export declare function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
/**
 * Combines timeout and retry logic
 */
export declare function withTimeoutAndRetry<T>(fn: () => Promise<T>, timeoutMs: number, retryOptions: RetryOptions, errorMessage?: string): Promise<T>;
//# sourceMappingURL=timeout.d.ts.map