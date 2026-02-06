import { describe, it, expect } from 'vitest';

describe('GitHub PR number extraction from URL', () => {
  const extractPRNumber = (url: string | undefined): number | null => {
    if (!url) return null;
    const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
    return match ? parseInt(match[1], 10) : null;
  };

  describe('Standard GitHub URLs', () => {
    it('should extract PR number from standard GitHub URL', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/75';
      expect(extractPRNumber(url)).toBe(75);
    });

    it('should extract PR number from URL with trailing slash', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/42/';
      expect(extractPRNumber(url)).toBe(42);
    });

    it('should extract PR number from URL with query parameters', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/100?tab=commits';
      expect(extractPRNumber(url)).toBe(100);
    });

    it('should extract large PR numbers', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/9999';
      expect(extractPRNumber(url)).toBe(9999);
    });
  });

  describe('Invalid URLs', () => {
    it('should return null for issue URLs', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/issues/75';
      expect(extractPRNumber(url)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractPRNumber('')).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(extractPRNumber(undefined)).toBeNull();
    });

    it('should return null for malformed URLs', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/abc';
      expect(extractPRNumber(url)).toBeNull();
    });
  });

  describe('PR number type handling', () => {
    it('should return number type, not string', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/123';
      const prNumber = extractPRNumber(url);
      expect(typeof prNumber).toBe('number');
      expect(prNumber).toBe(123);
    });

    it('should handle numbers with leading zeros', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/007';
      expect(extractPRNumber(url)).toBe(7);
    });
  });

  describe('Priority handling in pr submit', () => {
    const extractWithPriority = (options: { prNumber?: string; prUrl?: string }): number | null => {
      let prNumber = options.prNumber ? parseInt(options.prNumber, 10) : null;
      if (!prNumber && options.prUrl) {
        const match = options.prUrl.match(/\/pull\/(\d+)(?:\/|$|\?)/);
        if (match) {
          prNumber = parseInt(match[1], 10);
        }
      }
      return prNumber;
    };

    it('should prefer explicit --pr-number over URL extraction', () => {
      const options = {
        prNumber: '999',
        prUrl: 'https://github.com/nikrich/hungry-ghost-hive/pull/75',
      };
      expect(extractWithPriority(options)).toBe(999);
    });

    it('should use URL-extracted number when --pr-number not provided', () => {
      const options = {
        prNumber: undefined,
        prUrl: 'https://github.com/nikrich/hungry-ghost-hive/pull/75',
      };
      expect(extractWithPriority(options)).toBe(75);
    });

    it('should result in null when neither option provided', () => {
      const options = {
        prNumber: undefined,
        prUrl: undefined,
      };
      expect(extractWithPriority(options)).toBeNull();
    });

    it('should result in null when URL is invalid', () => {
      const options = {
        prNumber: undefined,
        prUrl: 'https://github.com/nikrich/hungry-ghost-hive/issues/75',
      };
      expect(extractWithPriority(options)).toBeNull();
    });
  });
});
