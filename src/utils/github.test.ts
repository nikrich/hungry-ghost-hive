// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { extractPRNumber } from './github.js';

describe('extractPRNumber', () => {
  it('should extract PR number from standard GitHub PR URL', () => {
    const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/114';
    const number = extractPRNumber(url);
    expect(number).toBe(114);
  });

  it('should extract PR number from URL with query parameters', () => {
    const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/123?something=value';
    const number = extractPRNumber(url);
    expect(number).toBe(123);
  });

  it('should extract PR number from URL with fragment', () => {
    const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/456#comment-section';
    const number = extractPRNumber(url);
    expect(number).toBe(456);
  });

  it('should return undefined for invalid URLs', () => {
    const invalidUrls = [
      'https://github.com/nikrich/hungry-ghost-hive',
      'https://github.com/nikrich/hungry-ghost-hive/issues/789',
      'https://example.com/pull/123',
      '',
      'not-a-url',
    ];

    for (const url of invalidUrls) {
      const number = extractPRNumber(url);
      expect(number).toBeUndefined();
    }
  });

  it('should handle large PR numbers', () => {
    const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/999999';
    const number = extractPRNumber(url);
    expect(number).toBe(999999);
  });

  it('should handle PR numbers with leading zeros gracefully', () => {
    const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/00123';
    const number = extractPRNumber(url);
    expect(number).toBe(123);
  });
});
