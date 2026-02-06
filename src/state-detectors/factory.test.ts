import { describe, it, expect } from 'vitest';
import { getStateDetector, isSupportedCLI } from './factory';
import { ClaudeStateDetector } from './claude';
import { CodexStateDetector } from './codex';
import { GeminiStateDetector } from './gemini';

describe('getStateDetector', () => {
  it('should return ClaudeStateDetector for claude CLI type', () => {
    const detector = getStateDetector('claude');
    expect(detector).toBeInstanceOf(ClaudeStateDetector);
  });

  it('should return CodexStateDetector for codex CLI type', () => {
    const detector = getStateDetector('codex');
    expect(detector).toBeInstanceOf(CodexStateDetector);
  });

  it('should return GeminiStateDetector for gemini CLI type', () => {
    const detector = getStateDetector('gemini');
    expect(detector).toBeInstanceOf(GeminiStateDetector);
  });

  it('should throw error for unsupported CLI type', () => {
    expect(() => getStateDetector('unknown' as any)).toThrow('Unsupported CLI type: unknown');
  });

  it('should create new instances on each call', () => {
    const detector1 = getStateDetector('claude');
    const detector2 = getStateDetector('claude');
    expect(detector1).not.toBe(detector2);
  });
});

describe('isSupportedCLI', () => {
  it('should return true for supported CLI types', () => {
    expect(isSupportedCLI('claude')).toBe(true);
    expect(isSupportedCLI('codex')).toBe(true);
    expect(isSupportedCLI('gemini')).toBe(true);
  });

  it('should return false for unsupported CLI types', () => {
    expect(isSupportedCLI('unknown')).toBe(false);
    expect(isSupportedCLI('gpt')).toBe(false);
    expect(isSupportedCLI('')).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(isSupportedCLI('Claude')).toBe(false);
    expect(isSupportedCLI('CLAUDE')).toBe(false);
  });
});
