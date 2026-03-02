// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import lockfile from 'proper-lockfile';
import { ConcurrencyError } from '../errors/index.js';

interface LockError extends Error {
  code?: string;
}

export interface LockOptions {
  timeout?: number; // Max time to wait for lock (ms), default 30000
  stale?: number; // Lock considered stale after (ms), default 60000
  retries?: {
    retries?: number; // Number of retry attempts, default 10
    minTimeout?: number; // Min wait between retries (ms), default 100
    maxTimeout?: number; // Max wait between retries (ms), default 1000
  };
  onCompromised?: (error: Error) => void; // Called if lock heartbeat is compromised
}

function getLockErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getLockErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as LockError).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Acquire exclusive lock for singleton processes (e.g., manager daemon)
 * Blocks until lock is acquired or timeout is reached
 *
 * @param lockPath - Path to lock target file (e.g., .hive/manager)
 * @param options - Lock acquisition options
 * @returns Release function to unlock
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(
  lockPath: string,
  options?: LockOptions
): Promise<() => Promise<void>> {
  // Ensure directory exists
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create lock target file if it doesn't exist
  if (!existsSync(lockPath)) {
    writeFileSync(lockPath, '');
  }

  let compromisedError: Error | null = null;
  const opts = {
    stale: options?.stale || 60000, // 60s default
    realpath: false,
    retries: {
      retries: options?.retries?.retries ?? 10,
      minTimeout: options?.retries?.minTimeout ?? 100,
      maxTimeout: options?.retries?.maxTimeout ?? 1000,
    },
    onCompromised: (err: Error) => {
      compromisedError = err;
      if (options?.onCompromised) {
        options.onCompromised(err);
        return;
      }

      console.warn(`Lock compromised for ${lockPath}: ${err.message}`);
    },
  };

  try {
    const release = await lockfile.lock(lockPath, opts);
    return async () => {
      try {
        await release();
      } catch (err) {
        const code = getLockErrorCode(err);
        if (code === 'ERELEASED' && compromisedError) {
          return;
        }

        throw new ConcurrencyError(`Failed to release lock: ${getLockErrorMessage(err)}.`);
      }
    };
  } catch (err) {
    const message = getLockErrorMessage(err);
    const code = getLockErrorCode(err);
    if (code === 'ELOCKED') {
      throw new ConcurrencyError(
        `Failed to acquire lock: ${message}. Another process may be holding the lock.`
      );
    }

    throw new ConcurrencyError(`Failed to acquire lock: ${message}.`);
  }
}

/**
 * Check if lock is currently held
 * Non-blocking check
 */
export async function isLocked(lockPath: string): Promise<boolean> {
  if (!existsSync(lockPath)) return false;

  try {
    return await lockfile.check(lockPath, { realpath: false });
  } catch (_error) {
    return false;
  }
}
