// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { parseTokenUsage } from './token-usage-parser.js';

describe('parseTokenUsage', () => {
  describe('empty and invalid input', () => {
    it('should return null for empty string', () => {
      expect(parseTokenUsage('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(parseTokenUsage('   \n\t  ')).toBeNull();
    });

    it('should return null for output with no token info', () => {
      expect(parseTokenUsage('Hello world\nSome random output\nDone.')).toBeNull();
    });
  });

  describe('Claude Code format', () => {
    it('should parse "Total tokens: N" format', () => {
      const output = `
Session complete.
Total tokens: 20,235
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 20235,
        cost: undefined,
      });
    });

    it('should parse individual input/output token lines', () => {
      const output = `
Total input tokens: 12,345
Total output tokens: 7,890
Total tokens: 20,235
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 12345,
        outputTokens: 7890,
        totalTokens: 20235,
        cost: undefined,
      });
    });

    it('should parse inline "Input: N / Output: N" format', () => {
      const output = `
Session summary
Input: 5,000 / Output: 7,345
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 5000,
        outputTokens: 7345,
        totalTokens: 12345,
        cost: undefined,
      });
    });

    it('should parse cost from output', () => {
      const output = `
Total input tokens: 10,000
Total output tokens: 5,000
Total tokens: 15,000
Total cost: $1.23
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        cost: 1.23,
      });
    });

    it('should parse "Cost: $N" without "Total" prefix', () => {
      const output = `
Input: 8,000 / Output: 4,000
Cost: $0.45
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 8000,
        outputTokens: 4000,
        totalTokens: 12000,
        cost: 0.45,
      });
    });

    it('should handle numbers without commas', () => {
      const output = `
Total input tokens: 500
Total output tokens: 300
Total tokens: 800
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 500,
        outputTokens: 300,
        totalTokens: 800,
        cost: undefined,
      });
    });

    it('should compute totalTokens when only input and output given', () => {
      const output = `
Total input tokens: 6,000
Total output tokens: 4,000
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 6000,
        outputTokens: 4000,
        totalTokens: 10000,
        cost: undefined,
      });
    });

    it('should parse inline format with pipe separator', () => {
      const output = 'Input: 3,000 | Output: 2,000';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 3000,
        outputTokens: 2000,
        totalTokens: 5000,
        cost: undefined,
      });
    });
  });

  describe('Codex format', () => {
    it('should parse "Tokens used: N (input: N, output: N)" format', () => {
      const output = `
Session complete.
Tokens used: 15,000 (input: 8,000, output: 7,000)
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 8000,
        outputTokens: 7000,
        totalTokens: 15000,
      });
    });

    it('should parse "Token usage - Input: N Output: N Total: N" format', () => {
      const output = 'Token usage - Input: 8,000 Output: 7,000 Total: 15,000';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 8000,
        outputTokens: 7000,
        totalTokens: 15000,
      });
    });

    it('should parse simple "tokens: N" format', () => {
      const output = 'tokens: 15000';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 15000,
      });
    });
  });

  describe('Gemini format', () => {
    it('should parse "Token count: input=N, output=N, total=N" format', () => {
      const output = 'Token count: input=5000, output=3000, total=8000';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 5000,
        outputTokens: 3000,
        totalTokens: 8000,
      });
    });

    it('should parse "Tokens: N total (N input, N output)" format', () => {
      const output = 'Tokens: 8,000 total (5,000 input, 3,000 output)';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 5000,
        outputTokens: 3000,
        totalTokens: 8000,
      });
    });

    it('should parse "Usage: N input tokens, N output tokens" format', () => {
      const output = 'Usage: 5,000 input tokens, 3,000 output tokens';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 5000,
        outputTokens: 3000,
        totalTokens: 8000,
      });
    });

    it('should handle Gemini format with commas in numbers', () => {
      const output = 'Token count: input=12,345, output=6,789, total=19,134';
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 12345,
        outputTokens: 6789,
        totalTokens: 19134,
      });
    });
  });

  describe('mixed output with noise', () => {
    it('should extract tokens from verbose Claude Code output', () => {
      const output = `
╭──────────────────────────────────────╮
│ ✻ Welcome to Claude Code!            │
╰──────────────────────────────────────╯

> Working on the task...

(thinking) about the problem

I'll help you fix this bug.

Edit src/foo.ts
Running tests... all passed

Total input tokens: 25,000
Total output tokens: 15,000
Total tokens: 40,000
Total cost: $2.50
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 25000,
        outputTokens: 15000,
        totalTokens: 40000,
        cost: 2.5,
      });
    });

    it('should extract tokens from Codex output with surrounding text', () => {
      const output = `
Starting Codex session...
Working on task...
Done!
Tokens used: 20,000 (input: 12,000, output: 8,000)
Session ended.
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 12000,
        outputTokens: 8000,
        totalTokens: 20000,
      });
    });
  });

  describe('priority order', () => {
    it('should prefer Claude format when both Claude and Codex patterns match', () => {
      const output = `
Total input tokens: 10,000
Total output tokens: 5,000
Total tokens: 15,000
tokens: 99999
      `;
      const result = parseTokenUsage(output);
      expect(result).toEqual({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        cost: undefined,
      });
    });
  });
});
