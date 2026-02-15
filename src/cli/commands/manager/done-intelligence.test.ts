// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessCompletionFromOutput, clearCompletionAssessmentCache, isCompletionCandidateOutput } from './done-intelligence.js';

const COMPLETE_STYLE_OUTPUT = `• Suppress Operator

- Added operator wiring and tests.

Testing: not run (not requested).

Next steps:
1. Run cargo test`;

const IN_PROGRESS_OUTPUT = `Working through runtime wiring now.
Need to inspect additional files before finishing.`;

const mockComplete = vi.fn();

vi.mock('../../../llm/index.js', () => ({
  createProvider: vi.fn(() => ({
    name: 'mock',
    complete: mockComplete,
  })),
}));

const mockConfig = {
  models: {
    tech_lead: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      max_tokens: 16000,
      temperature: 0.7,
      cli_tool: 'codex',
      safety_mode: 'unsafe',
    },
  },
} as any;

describe('done intelligence', () => {
  beforeEach(() => {
    clearCompletionAssessmentCache();
    mockComplete.mockReset();
  });

  it('detects completion-candidate output heuristically', () => {
    expect(isCompletionCandidateOutput(COMPLETE_STYLE_OUTPUT)).toBe(true);
    expect(isCompletionCandidateOutput(IN_PROGRESS_OUTPUT)).toBe(false);
  });

  it('uses AI classifier and parses JSON response', async () => {
    mockComplete.mockResolvedValue({
      content: '{"done":true,"confidence":0.93,"reason":"Final implementation summary detected"}',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-intermediate-team-1',
      'STORY-123',
      COMPLETE_STYLE_OUTPUT
    );

    expect(result.done).toBe(true);
    expect(result.confidence).toBe(0.93);
    expect(result.usedAi).toBe(true);
  });

  it('caches same output fingerprint to avoid repeated AI calls', async () => {
    mockComplete.mockResolvedValue({
      content: '{"done":true,"confidence":0.9,"reason":"done"}',
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const args = [mockConfig, 'hive-junior-team-1', 'STORY-555', COMPLETE_STYLE_OUTPUT] as const;
    const first = await assessCompletionFromOutput(...args);
    const second = await assessCompletionFromOutput(...args);

    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});
