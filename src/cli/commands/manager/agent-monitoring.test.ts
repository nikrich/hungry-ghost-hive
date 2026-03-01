// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import {
  detectAgentState,
  submitManagerNudgeWithVerification,
} from './agent-monitoring.js';

vi.mock('../../../tmux/manager.js', () => ({
  autoApprovePermission: vi.fn(),
  captureTmuxPane: vi.fn(),
  forceBypassMode: vi.fn(),
  sendEnterToTmuxSession: vi.fn(),
  sendMessageWithConfirmation: vi.fn(),
  sendToTmuxSession: vi.fn(),
}));

const INTERRUPTION_BANNER = `■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit \`/feedback\` to report the issue.`;
const RATE_LIMIT_BANNER =
  '■ exceeded retry limit, last status: 429 Too Many Requests, request id: abc123';
const ANTHROPIC_RATE_LIMIT =
  'API Error: {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}';
const GEMINI_RATE_LIMIT =
  'RESOURCE_EXHAUSTED: Quota exceeded for quota metric GenerateContent requests per minute.';
const INTERACTIVE_PROMPT = '› Improve documentation in @filename\n\n  ? for shortcuts';
const INTERACTIVE_PROMPT_WITH_PASTE = '› [Pasted Content 1203 chars]\n\n  16% context left';
const INTERACTIVE_QUESTION_PROMPT = '› Should I submit this PR now?\n\n  12% context left';
const INTERACTIVE_PROMPT_WITH_MODEL_METER =
  '› Explain this codebase\n\n  gpt-5.2-codex xhigh · 99% left';
const START_MARKER = '[HIVE_MANAGER_NUDGE_START]';
const ID_MARKER = '[HIVE_MANAGER_NUDGE_ID]';
const END_MARKER = '[HIVE_MANAGER_NUDGE_END]';

describe('detectAgentState interruption fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats interruption banner as blocked for codex sessions', () => {
    const result = detectAgentState(INTERRUPTION_BANNER, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });

  it('applies interruption fallback for other cli tools', () => {
    const result = detectAgentState(INTERRUPTION_BANNER, 'claude');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.needsHuman).toBe(true);
  });

  it('prioritizes interruption over stale working text in pane history', () => {
    const output = `I'm working through the design.\n${INTERRUPTION_BANNER}`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.needsHuman).toBe(true);
  });

  it('ignores stale interruption banners outside the recent pane window', () => {
    const staleLines = Array.from({ length: 90 }, (_, i) => `old line ${i}`).join('\n');
    const output = `${INTERRUPTION_BANNER}\n${staleLines}\n${INTERACTIVE_PROMPT}`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(result.needsHuman).toBe(false);
  });

  it('treats rate limit prompts as recoverable waiting state', () => {
    const result = detectAgentState(RATE_LIMIT_BANNER, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('prioritizes rate-limit fallback over stale question text in pane history', () => {
    const output = `${RATE_LIMIT_BANNER}\n› Write tests for @filename`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.needsHuman).toBe(false);
  });

  it('detects anthropic/openai style rate-limit errors', () => {
    const result = detectAgentState(ANTHROPIC_RATE_LIMIT, 'claude');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('detects gemini resource exhausted quota errors', () => {
    const result = detectAgentState(GEMINI_RATE_LIMIT, 'gemini');

    expect(result.state).toBe(AgentState.USER_DECLINED);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('does not treat planning text about rate limits as blocked state', () => {
    const output = 'Plan: add rate limiting middleware and return 429 for burst traffic.';
    const result = detectAgentState(output, 'codex');

    expect(result.state).not.toBe(AgentState.USER_DECLINED);
  });

  it('detects idle interactive prompt for codex sessions', () => {
    const result = detectAgentState(INTERACTIVE_PROMPT, 'codex');

    expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('detects idle interactive prompt across all cli providers', () => {
    const claudeResult = detectAgentState(INTERACTIVE_PROMPT, 'claude');
    const geminiResult = detectAgentState(INTERACTIVE_PROMPT, 'gemini');

    expect(claudeResult.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(claudeResult.needsHuman).toBe(false);
    expect(geminiResult.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(geminiResult.needsHuman).toBe(false);
  });

  it('prioritizes interactive prompt over stale processing text', () => {
    const output = `Partition processing now complete.\n${INTERACTIVE_PROMPT}`;
    const result = detectAgentState(output, 'codex');

    expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(result.needsHuman).toBe(false);
  });

  it('detects interactive prompt with pasted-content and context-left ui', () => {
    const result = detectAgentState(INTERACTIVE_PROMPT_WITH_PASTE, 'codex');

    expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('detects interactive prompt with model status meter', () => {
    const result = detectAgentState(INTERACTIVE_PROMPT_WITH_MODEL_METER, 'claude');

    expect(result.state).toBe(AgentState.IDLE_AT_PROMPT);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(false);
  });

  it('detects interactive prompt with explicit question as human-needed', () => {
    const result = detectAgentState(INTERACTIVE_QUESTION_PROMPT, 'codex');

    expect(result.state).toBe(AgentState.ASKING_QUESTION);
    expect(result.isWaiting).toBe(true);
    expect(result.needsHuman).toBe(true);
  });
});

describe('submitManagerNudgeWithVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms when the latest prompt block no longer contains current nudge id', async () => {
    const { captureTmuxPane, sendEnterToTmuxSession } = await import('../../../tmux/manager.js');
    const nudgeId = 'nudge-123';
    const paneOutput = `› # ${START_MARKER} ${nudgeId}
  # ${ID_MARKER} ${nudgeId}
  # ${END_MARKER} ${nudgeId}
› Explain this codebase`;
    vi.mocked(captureTmuxPane).mockResolvedValue(paneOutput);

    const result = await submitManagerNudgeWithVerification('hive-agent-1', nudgeId, {
      maxChecks: 1,
      checkIntervalMs: 10,
    });

    expect(result.confirmed).toBe(true);
    expect(result.enterPresses).toBe(0);
    expect(result.retryEnters).toBe(0);
    expect(sendEnterToTmuxSession).not.toHaveBeenCalled();
  });

  it('retries Enter when latest prompt block still contains nudge id', async () => {
    const { captureTmuxPane, sendEnterToTmuxSession } = await import('../../../tmux/manager.js');
    const nudgeId = 'nudge-456';
    const pendingOutput = `› # ${START_MARKER} ${nudgeId}
  # ${ID_MARKER} ${nudgeId}
  # ${END_MARKER} ${nudgeId}`;
    const resolvedOutput = '› Summarize recent commits';
    vi.mocked(captureTmuxPane)
      .mockResolvedValueOnce(pendingOutput)
      .mockResolvedValueOnce(resolvedOutput);

    const result = await submitManagerNudgeWithVerification('hive-agent-2', nudgeId, {
      maxChecks: 2,
      checkIntervalMs: 10,
    });

    expect(result.confirmed).toBe(true);
    expect(result.checks).toBe(2);
    expect(result.enterPresses).toBe(1);
    expect(result.retryEnters).toBe(1);
    expect(sendEnterToTmuxSession).toHaveBeenCalledTimes(1);
  });

  it('caps Enter retries while waiting for confirmation', async () => {
    const { captureTmuxPane, sendEnterToTmuxSession } = await import('../../../tmux/manager.js');
    const nudgeId = 'nudge-789';
    const pendingOutput = `› # ${START_MARKER} ${nudgeId}
  # ${ID_MARKER} ${nudgeId}
  # ${END_MARKER} ${nudgeId}`;
    vi.mocked(captureTmuxPane).mockResolvedValue(pendingOutput);

    const result = await submitManagerNudgeWithVerification('hive-agent-3', nudgeId, {
      maxChecks: 20,
      checkIntervalMs: 10,
      maxEnterPresses: 3,
    });

    expect(result.confirmed).toBe(false);
    expect(result.checks).toBe(20);
    expect(result.enterPresses).toBe(3);
    expect(result.retryEnters).toBe(3);
    expect(sendEnterToTmuxSession).toHaveBeenCalledTimes(3);
  });
});
