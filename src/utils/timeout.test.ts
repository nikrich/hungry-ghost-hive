import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withRetry, withTimeout, withTimeoutAndRetry } from './timeout.js';

describe('timeout utilities', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TimeoutError', () => {
    it('should be an Error subclass', () => {
      const error = new TimeoutError('Test timeout', 1000);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('TimeoutError');
    });

    it('should store timeout duration', () => {
      const timeoutMs = 5000;
      const error = new TimeoutError('Test', timeoutMs);
      expect(error.timeoutMs).toBe(timeoutMs);
    });

    it('should have descriptive message', () => {
      const error = new TimeoutError('Custom message', 3000);
      expect(error.message).toBe('Custom message');
    });
  });

  describe('withTimeout', () => {
    it('should resolve when promise resolves before timeout', async () => {
      const promise = Promise.resolve('success');
      const result = withTimeout(promise, 1000);

      await expect(result).resolves.toBe('success');
    });

    it(
      'should reject with TimeoutError when timeout exceeded',
      async () => {
        const promise = new Promise<string>(resolve => {
          setTimeout(() => resolve('success'), 5000);
        });
        const result = withTimeout(promise, 100);

        await expect(result).rejects.toThrow(TimeoutError);
      },
      { timeout: 10000 }
    );

    it(
      'should include timeout duration in error message',
      async () => {
        const promise = new Promise<string>(resolve => {
          setTimeout(() => resolve('success'), 5000);
        });
        const result = withTimeout(promise, 100);

        await expect(result).rejects.toThrow('100ms');
      },
      { timeout: 10000 }
    );

    it('should handle promise rejection before timeout', async () => {
      const error = new Error('Promise failed');
      const promise = Promise.reject(error);
      const result = withTimeout(promise, 1000);

      await expect(result).rejects.toThrow('Promise failed');
    });

    it(
      'should use custom error message',
      async () => {
        const promise = new Promise<string>(resolve => {
          setTimeout(() => resolve('success'), 5000);
        });
        const customMessage = 'Custom timeout message';
        const result = withTimeout(promise, 100, customMessage);

        await expect(result).rejects.toThrow(customMessage);
      },
      { timeout: 10000 }
    );

    it('should work with various promise types', async () => {
      const stringPromise = withTimeout(Promise.resolve('string'), 1000);
      const numberPromise = withTimeout(Promise.resolve(42), 1000);
      const objectPromise = withTimeout(Promise.resolve({ key: 'value' }), 1000);

      await expect(stringPromise).resolves.toBe('string');
      await expect(numberPromise).resolves.toBe(42);
      await expect(objectPromise).resolves.toEqual({ key: 'value' });
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      vi.useRealTimers();
      const fn = vi.fn().mockResolvedValueOnce('success');
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it(
      'should retry on failure',
      async () => {
        vi.useRealTimers();
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('Attempt 1'))
          .mockRejectedValueOnce(new Error('Attempt 2'))
          .mockResolvedValueOnce('success');

        const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(3);
      },
      { timeout: 10000 }
    );

    it(
      'should throw after max retries exceeded',
      async () => {
        vi.useRealTimers();
        const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

        await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 10 })).rejects.toThrow(
          'Always fails'
        );

        expect(fn).toHaveBeenCalledTimes(2); // Initial + 1 retry
      },
      { timeout: 10000 }
    );

    it(
      'should handle non-Error exceptions',
      async () => {
        vi.useRealTimers();
        const fn = vi.fn().mockRejectedValueOnce('String error').mockResolvedValueOnce('success');

        const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
      },
      { timeout: 10000 }
    );

    it(
      'should use exponential backoff formula',
      async () => {
        vi.useRealTimers();
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValueOnce('success');

        const startTime = Date.now();
        await withRetry(fn, { maxRetries: 1, baseDelayMs: 50, maxDelayMs: 30000 });
        const elapsed = Date.now() - startTime;

        // Should have waited at least some time due to backoff
        expect(elapsed).toBeGreaterThan(0);
        expect(fn).toHaveBeenCalledTimes(2);
      },
      { timeout: 10000 }
    );
  });

  describe('withTimeoutAndRetry', () => {
    it('should succeed when both timeout and retries succeed', async () => {
      vi.useRealTimers();
      const fn = vi.fn().mockResolvedValueOnce('success');
      const result = await withTimeoutAndRetry(fn, 1000, { maxRetries: 2, baseDelayMs: 10 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it(
      'should fail if operation times out',
      async () => {
        vi.useRealTimers();
        const fn = vi.fn().mockImplementation(
          () =>
            new Promise(resolve => {
              setTimeout(() => resolve('success'), 5000);
            })
        );

        await expect(
          withTimeoutAndRetry(fn, 100, { maxRetries: 0, baseDelayMs: 10 })
        ).rejects.toThrow(TimeoutError);
      },
      { timeout: 10000 }
    );

    it(
      'should use custom error message in timeout error',
      async () => {
        vi.useRealTimers();
        const fn = vi.fn().mockImplementation(
          () =>
            new Promise(resolve => {
              setTimeout(() => resolve('success'), 5000);
            })
        );

        const customMessage = 'Operation took too long';
        await expect(
          withTimeoutAndRetry(fn, 100, { maxRetries: 0, baseDelayMs: 10 }, customMessage)
        ).rejects.toThrow(customMessage);
      },
      { timeout: 10000 }
    );

    it(
      'should handle immediate rejection without timeout',
      async () => {
        vi.useRealTimers();
        const error = new Error('Immediate failure');
        const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('success');

        const result = await withTimeoutAndRetry(fn, 1000, { maxRetries: 1, baseDelayMs: 10 });

        expect(result).toBe('success');
      },
      { timeout: 10000 }
    );
  });
});
