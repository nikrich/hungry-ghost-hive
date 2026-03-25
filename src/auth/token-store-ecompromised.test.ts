// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockLockFn } = vi.hoisted(() => ({ mockLockFn: vi.fn() }));

vi.mock('proper-lockfile', () => ({
  default: { lock: mockLockFn },
}));

import { TokenStore } from './token-store.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'token-store-ecompromised-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe('TokenStore acquireLockWithRetry', () => {
  describe('ECOMPROMISED error handling', () => {
    it('should throw immediately on ECOMPROMISED without retrying', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-test123\n', 'utf-8');

      const compromisedError = Object.assign(new Error('Lock compromised'), {
        code: 'ECOMPROMISED',
      });
      mockLockFn.mockRejectedValue(compromisedError);

      const store = new TokenStore(envPath);
      await expect(store.loadFromEnv(envPath)).rejects.toMatchObject({ code: 'ECOMPROMISED' });

      // Should have been called exactly once — ECOMPROMISED is not retried
      expect(mockLockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on non-ECOMPROMISED lock errors', async () => {
      const tempDir = createTempDir();
      const envPath = join(tempDir, '.env');
      writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-test123\n', 'utf-8');

      const lockedError = Object.assign(new Error('Lock already held'), { code: 'ELOCKED' });
      mockLockFn.mockRejectedValue(lockedError);

      const store = new TokenStore(envPath);
      await expect(store.loadFromEnv(envPath)).rejects.toMatchObject({ code: 'ELOCKED' });

      // Should have retried LOCK_MAX_RETRIES (5) + 1 initial attempt = 6 calls
      expect(mockLockFn).toHaveBeenCalledTimes(6);
    });
  });
});
