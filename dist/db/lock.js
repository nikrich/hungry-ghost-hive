import lockfile from 'proper-lockfile';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
/**
 * Acquire exclusive lock for singleton processes (e.g., manager daemon)
 * Blocks until lock is acquired or timeout is reached
 *
 * @param lockPath - Path to lock file (e.g., .hive/manager.lock)
 * @param options - Lock acquisition options
 * @returns Release function to unlock
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(lockPath, options) {
    const lockFile = `${lockPath}.lock`;
    // Ensure directory exists
    const dir = dirname(lockFile);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    // Create lock file if it doesn't exist
    if (!existsSync(lockFile)) {
        writeFileSync(lockFile, '');
    }
    const opts = {
        stale: options?.stale || 60000, // 60s default
        retries: {
            retries: options?.retries?.retries ?? 10,
            minTimeout: options?.retries?.minTimeout ?? 100,
            maxTimeout: options?.retries?.maxTimeout ?? 1000,
        },
    };
    try {
        const release = await lockfile.lock(lockFile, opts);
        return release;
    }
    catch (err) {
        throw new Error(`Failed to acquire lock: ${err instanceof Error ? err.message : 'Unknown error'}. ` +
            `Another process may be holding the lock.`);
    }
}
/**
 * Check if lock is currently held
 * Non-blocking check
 */
export async function isLocked(lockPath) {
    const lockFile = `${lockPath}.lock`;
    if (!existsSync(lockFile))
        return false;
    try {
        return await lockfile.check(lockFile);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=lock.js.map