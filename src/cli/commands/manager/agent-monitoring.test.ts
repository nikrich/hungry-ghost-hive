// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import { detectAgentState } from './agent-monitoring.js';

const INTERRUPTION_BANNER = `■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit \`/feedback\` to report the issue.`;

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
});
