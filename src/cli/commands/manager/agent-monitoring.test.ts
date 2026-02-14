// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import { detectAgentState } from './agent-monitoring.js';

const INTERRUPTION_BANNER = `■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit \`/feedback\` to report the issue.`;
const RATE_LIMIT_BANNER =
  '■ exceeded retry limit, last status: 429 Too Many Requests, request id: abc123';

describe('detectAgentState interruption fallback', () => {
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
});
