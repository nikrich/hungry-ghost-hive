// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, isLocked } from './lock.js';

describe('Database Lock', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'hive-lock-test-'));
    lockPath = join(testDir, 'test.lock');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should acquire and release lock', async () => {
    const release = await acquireLock(lockPath);
    expect(await isLocked(lockPath)).toBe(true);

    await release();
    expect(await isLocked(lockPath)).toBe(false);
  });

  it('should block second lock attempt', async () => {
    const release1 = await acquireLock(lockPath);

    // Second attempt should block/timeout
    const lockPromise = acquireLock(lockPath, {
      retries: { retries: 2, minTimeout: 100, maxTimeout: 100 },
    });

    await expect(lockPromise).rejects.toThrow('Failed to acquire lock');

    await release1();
  });

  it('should acquire lock after release', async () => {
    const release1 = await acquireLock(lockPath);
    await release1();

    // Should succeed immediately
    const release2 = await acquireLock(lockPath);
    expect(await isLocked(lockPath)).toBe(true);
    await release2();
  });

  it('should create lock file in non-existent directory', async () => {
    const deepPath = join(testDir, 'deep', 'nested', 'path', 'test.lock');
    const release = await acquireLock(deepPath);

    expect(await isLocked(deepPath)).toBe(true);

    await release();
  });

  it('should handle multiple sequential lock acquisitions', async () => {
    for (let i = 0; i < 5; i++) {
      const release = await acquireLock(lockPath);
      expect(await isLocked(lockPath)).toBe(true);
      await release();
      expect(await isLocked(lockPath)).toBe(false);
    }
  });

  it('should return false for isLocked when lock file does not exist', async () => {
    const nonExistentPath = join(testDir, 'nonexistent.lock');
    expect(await isLocked(nonExistentPath)).toBe(false);
  });

  it('should handle concurrent lock attempts gracefully', async () => {
    const release1 = await acquireLock(lockPath);

    // Start multiple concurrent lock attempts (all should fail)
    const attempts = [
      acquireLock(lockPath, { retries: { retries: 1, minTimeout: 50, maxTimeout: 50 } }),
      acquireLock(lockPath, { retries: { retries: 1, minTimeout: 50, maxTimeout: 50 } }),
      acquireLock(lockPath, { retries: { retries: 1, minTimeout: 50, maxTimeout: 50 } }),
    ];

    const results = await Promise.allSettled(attempts);

    // All should be rejected
    results.forEach(result => {
      expect(result.status).toBe('rejected');
    });

    await release1();
  });
});
