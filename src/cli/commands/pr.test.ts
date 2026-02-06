import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database } from 'sql.js';

describe('pr submit command - github_pr_number extraction', () => {
  describe('PR number extraction from URL', () => {
    it('should extract PR number from standard GitHub URL', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/75';
      const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('75');
    });

    it('should extract PR number from URL with trailing slash', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/42/';
      const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('42');
    });

    it('should extract PR number from URL with query parameters', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/100?tab=commits';
      const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
      expect(match).toBeTruthy();
      expect(match?.[1]).toBe('100');
    });

    it('should return null for invalid URL format', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/issues/75';
      const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
      expect(match).toBeNull();
    });

    it('should handle empty string gracefully', () => {
      const url = '';
      const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
      expect(match).toBeNull();
    });

    it('should correctly parse PR number as integer', () => {
      const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/123';
      const match = url.match(/\/pull\/(\d+)(?:\/|$|\?)/);
      const prNumber = match ? parseInt(match[1], 10) : null;
      expect(prNumber).toBe(123);
      expect(typeof prNumber).toBe('number');
    });
  });

  describe('PR number priority handling', () => {
    it('should prefer explicit --pr-number over URL extraction', () => {
      const options = {
        prNumber: '999',
        prUrl: 'https://github.com/nikrich/hungry-ghost-hive/pull/75',
      };

      let prNumber = options.prNumber ? parseInt(options.prNumber, 10) : null;
      if (!prNumber && options.prUrl) {
        const match = options.prUrl.match(/\/pull\/(\d+)(?:\/|$|\?)/);
        if (match) {
          prNumber = parseInt(match[1], 10);
        }
      }

      expect(prNumber).toBe(999);
    });

    it('should use URL-extracted number when --pr-number not provided', () => {
      const options = {
        prNumber: undefined,
        prUrl: 'https://github.com/nikrich/hungry-ghost-hive/pull/75',
      };

      let prNumber = options.prNumber ? parseInt(options.prNumber, 10) : null;
      if (!prNumber && options.prUrl) {
        const match = options.prUrl.match(/\/pull\/(\d+)(?:\/|$|\?)/);
        if (match) {
          prNumber = parseInt(match[1], 10);
        }
      }

      expect(prNumber).toBe(75);
    });

    it('should result in null when neither --pr-number nor valid URL provided', () => {
      const options = {
        prNumber: undefined,
        prUrl: 'https://github.com/nikrich/hungry-ghost-hive/issues/75',
      };

      let prNumber = options.prNumber ? parseInt(options.prNumber, 10) : null;
      if (!prNumber && options.prUrl) {
        const match = options.prUrl.match(/\/pull\/(\d+)(?:\/|$|\?)/);
        if (match) {
          prNumber = parseInt(match[1], 10);
        }
      }

      expect(prNumber).toBeNull();
    });
  });
});
