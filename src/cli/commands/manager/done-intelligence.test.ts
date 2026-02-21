// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assessCompletionFromOutput,
  clearCompletionAssessmentCache,
  isCompletionCandidateOutput,
} from './done-intelligence.js';

const COMPLETE_STYLE_OUTPUT = `• Suppress Operator

- Added operator wiring and tests.

Testing: not run (not requested).

Next steps:
1. Run cargo test`;

const IN_PROGRESS_OUTPUT = `Working through runtime wiring now.
Need to inspect additional files before finishing.`;

const DONE_LOCALLY_PENDING_SUBMIT_OUTPUT = `Story STORY-014 still IN_PROGRESS; all requested code changes are done locally.
Next required steps: run tests, submit PR via hive pr submit, and mark story complete.`;

const FINAL_SUMMARY_OUTPUT = `Implemented operator wiring and language templates.

Changes:
- Added runtime operator and tests.
- Updated template renderers.

Testing: not run (missing proto files in workspace).

Next steps:
1. Submit PR to merge queue
2. Mark story complete`;

const FINAL_SUMMARY_WITH_PROMPT_OUTPUT = `Implemented operator wiring and language templates.

Changes:
- Added runtime operator and tests.
- Updated template renderers.

Testing: pass.

Next steps:
1. Submit PR to merge queue
2. Mark story complete

? for shortcuts`;

const BLOCKED_OUTPUT = `No other work can proceed until missing proto files are restored.
Story remains IN_PROGRESS and blocked.`;

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));
vi.mock('execa', () => ({
  execa: mockExeca,
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
  manager: {
    completion_classifier: {
      cli_tool: 'claude',
      model: 'gpt-5.2-codex',
      timeout_ms: 12000,
    },
  },
} as any;

describe('done intelligence', () => {
  beforeEach(() => {
    clearCompletionAssessmentCache();
    mockExeca.mockReset();
  });

  it('detects completion-candidate output heuristically', () => {
    expect(isCompletionCandidateOutput(COMPLETE_STYLE_OUTPUT)).toBe(true);
    expect(isCompletionCandidateOutput(IN_PROGRESS_OUTPUT)).toBe(false);
  });

  it('uses local CLI classifier and parses JSON response', async () => {
    mockExeca.mockResolvedValue({
      stdout: '{"done":true,"confidence":0.93,"reason":"Final implementation summary detected"}',
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

  it('caches same output fingerprint to avoid repeated classifier calls', async () => {
    mockExeca.mockResolvedValue({
      stdout: '{"done":true,"confidence":0.9,"reason":"done"}',
    });

    const args = [mockConfig, 'hive-junior-team-1', 'STORY-555', COMPLETE_STYLE_OUTPUT] as const;
    const first = await assessCompletionFromOutput(...args);
    const second = await assessCompletionFromOutput(...args);

    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
    expect(mockExeca).toHaveBeenCalledTimes(1);
  });

  it('falls back to heuristic done classification when local classifier is unavailable', async () => {
    mockExeca.mockRejectedValue(new Error('claude CLI unavailable'));

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-intermediate-team-2',
      'STORY-014',
      DONE_LOCALLY_PENDING_SUBMIT_OUTPUT
    );

    expect(result.done).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.82);
    expect(result.reason).toContain('Heuristic: implementation appears complete');
    expect(result.reason).toContain('local classifier unavailable');
    expect(result.usedAi).toBe(false);
  });

  it('does not mark blocked outputs as done when local classifier is unavailable', async () => {
    mockExeca.mockRejectedValue(new Error('claude CLI unavailable'));

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-junior-team-4',
      'STORY-999',
      BLOCKED_OUTPUT
    );

    expect(result.done).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('Local classifier unavailable');
  });

  it('overrides contradictory AI done=false result when reason indicates post-work summary', async () => {
    mockExeca.mockResolvedValue({
      stdout:
        '{"done":false,"confidence":0.48,"reason":"Output includes a completed implementation summary with tests and next steps, indicating post-work summary state."}',
    });

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-intermediate-team-9',
      'STORY-777',
      FINAL_SUMMARY_OUTPUT
    );

    expect(result.done).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.84);
    expect(result.reason).toContain('overriding conflicting AI done=false classification');
  });

  it('overrides done=false for broader post-work report phrasing', async () => {
    mockExeca.mockResolvedValue({
      stdout:
        '{"done":false,"confidence":0.61,"reason":"Output shows an implementation summary with completed changes and test status, indicating post-work report rather than ongoing execution or planning."}',
    });

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-intermediate-team-10',
      'STORY-779',
      FINAL_SUMMARY_OUTPUT
    );

    expect(result.done).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.84);
    expect(result.reason).toContain('overriding conflicting AI done=false classification');
  });

  it('does not override done=false when AI reason explicitly says output is not final', async () => {
    mockExeca.mockResolvedValue({
      stdout:
        '{"done":false,"confidence":0.86,"reason":"Output includes a request to run /review and does not clearly indicate a final implementation summary completion state by the agent."}',
    });

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-junior-team-11',
      'STORY-780',
      FINAL_SUMMARY_OUTPUT
    );

    expect(result.done).toBe(false);
    expect(result.confidence).toBe(0.86);
  });

  it('keeps done=false when AI reason indicates active incomplete work', async () => {
    mockExeca.mockResolvedValue({
      stdout:
        '{"done":false,"confidence":0.88,"reason":"Output includes ongoing work, stated next steps, and incomplete Python/Kotlin updates; not a final completion summary ready for PR submission."}',
    });

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-junior-team-9',
      'STORY-778',
      IN_PROGRESS_OUTPUT
    );

    expect(result.done).toBe(false);
    expect(result.confidence).toBe(0.88);
  });

  it('keeps heuristic done for final summaries with trailing shortcut prompt text', async () => {
    mockExeca.mockRejectedValue(new Error('classifier unavailable'));

    const result = await assessCompletionFromOutput(
      mockConfig,
      'hive-junior-team-12',
      'STORY-781',
      FINAL_SUMMARY_WITH_PROMPT_OUTPUT
    );

    expect(result.done).toBe(true);
    expect(result.reason).toContain('local classifier unavailable');
  });
});
