export interface LockOptions {
    timeout?: number;
    stale?: number;
    retries?: {
        retries?: number;
        minTimeout?: number;
        maxTimeout?: number;
    };
}
/**
 * Acquire exclusive lock for singleton processes (e.g., manager daemon)
 * Blocks until lock is acquired or timeout is reached
 *
 * @param lockPath - Path to lock file (e.g., .hive/manager.lock)
 * @param options - Lock acquisition options
 * @returns Release function to unlock
 * @throws Error if lock cannot be acquired within timeout
 */
export declare function acquireLock(lockPath: string, options?: LockOptions): Promise<() => Promise<void>>;
/**
 * Check if lock is currently held
 * Non-blocking check
 */
export declare function isLocked(lockPath: string): Promise<boolean>;
//# sourceMappingURL=lock.d.ts.map