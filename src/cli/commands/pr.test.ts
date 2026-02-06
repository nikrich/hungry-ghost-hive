import { describe, it, expect } from 'vitest';

// Helper function to extract PR number from URL or explicit option
function extractPRNumber(prNumber: string | null, prUrl: string | null): number | null {
  let number = prNumber ? parseInt(prNumber, 10) : null;
  if (!number && prUrl) {
    const urlMatch = prUrl.match(/\/pull\/(\d+)/);
    if (urlMatch) {
      number = parseInt(urlMatch[1], 10);
    }
  }
  return number;
}

describe('PR submit command - GitHub PR number extraction', () => {
  it('should extract PR number from GitHub URL', () => {
    // Test URL parsing logic
    const urlPattern = /\/pull\/(\d+)/;
    const url = 'https://github.com/nikrich/hungry-ghost-hive/pull/77';
    const match = url.match(urlPattern);
    expect(match).toBeTruthy();
    expect(match?.[1]).toBe('77');
  });

  it('should extract PR number from various GitHub URL formats', () => {
    const urlPattern = /\/pull\/(\d+)/;

    const testCases = [
      { url: 'https://github.com/nikrich/hungry-ghost-hive/pull/77', expectedNum: '77' },
      { url: 'https://github.com/org/repo/pull/123', expectedNum: '123' },
      { url: 'https://github.com/a/b/pull/1', expectedNum: '1' },
      { url: 'https://github.com/a/b/pull/99999', expectedNum: '99999' },
    ];

    for (const testCase of testCases) {
      const match = testCase.url.match(urlPattern);
      expect(match?.[1]).toBe(testCase.expectedNum);
    }
  });

  it('should handle PR URLs without pull number', () => {
    const urlPattern = /\/pull\/(\d+)/;
    const url = 'https://github.com/nikrich/hungry-ghost-hive';
    const match = url.match(urlPattern);
    expect(match).toBeNull();
  });

  it('should prefer explicit PR number over URL extraction', () => {
    // When both --pr-number and --pr-url are provided,
    // --pr-number should take precedence (it's parsed first)
    const result = extractPRNumber('42', 'https://github.com/nikrich/hungry-ghost-hive/pull/77');
    expect(result).toBe(42);
  });

  it('should extract PR number from URL when explicit number is not provided', () => {
    // When only --pr-url is provided
    const result = extractPRNumber(null, 'https://github.com/nikrich/hungry-ghost-hive/pull/77');
    expect(result).toBe(77);
  });

  it('should handle case with neither number nor URL', () => {
    const result = extractPRNumber(null, null);
    expect(result).toBeNull();
  });

  it('should return null when URL does not contain PR number', () => {
    const result = extractPRNumber(null, 'https://github.com/nikrich/hungry-ghost-hive');
    expect(result).toBeNull();
  });
});
