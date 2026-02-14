// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { AgentRow, EscalationRow } from '../../../db/client.js';
import { findStaleSessionEscalations } from './stale-escalations.js';

function buildEscalation(
  overrides: Partial<EscalationRow> = {},
  createdAt = '2026-02-14T00:00:00.000Z'
): EscalationRow {
  return {
    id: 'ESC-TEST1',
    story_id: null,
    from_agent_id: 'hive-intermediate-grigora',
    to_agent_id: null,
    reason: 'Approval required',
    status: 'pending',
    resolution: null,
    created_at: createdAt,
    resolved_at: null,
    ...overrides,
  };
}

function buildAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'intermediate-1',
    type: 'intermediate',
    team_id: 'team-1',
    tmux_session: 'hive-intermediate-grigora',
    model: 'gpt-5.1-codex-mini',
    status: 'working',
    current_story_id: 'STORY-003',
    memory_state: null,
    cli_tool: 'codex',
    worktree_path: null,
    created_at: '2026-02-14T00:00:00.000Z',
    updated_at: '2026-02-14T00:00:00.000Z',
    last_seen: '2026-02-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('findStaleSessionEscalations', () => {
  it('flags escalation when source agent is terminated and session is gone', () => {
    const stale = findStaleSessionEscalations({
      pendingEscalations: [buildEscalation()],
      agents: [buildAgent({ status: 'terminated' })],
      liveSessionNames: new Set<string>(),
      nowMs: Date.parse('2026-02-14T00:10:00.000Z'),
      staleAfterMs: 60_000,
    });

    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toContain('terminated');
  });

  it('does not flag escalation when source session is currently live', () => {
    const stale = findStaleSessionEscalations({
      pendingEscalations: [buildEscalation()],
      agents: [buildAgent()],
      liveSessionNames: new Set<string>(['hive-intermediate-grigora']),
      nowMs: Date.parse('2026-02-14T00:10:00.000Z'),
      staleAfterMs: 60_000,
    });

    expect(stale).toHaveLength(0);
  });

  it('flags escalation when source session/agent no longer exists', () => {
    const stale = findStaleSessionEscalations({
      pendingEscalations: [buildEscalation({ from_agent_id: 'hive-missing-agent' })],
      agents: [buildAgent()],
      liveSessionNames: new Set<string>(),
      nowMs: Date.parse('2026-02-14T00:10:00.000Z'),
      staleAfterMs: 60_000,
    });

    expect(stale).toHaveLength(1);
    expect(stale[0].reason).toContain('no longer exists');
  });

  it('does not flag escalation that is younger than stale threshold', () => {
    const stale = findStaleSessionEscalations({
      pendingEscalations: [buildEscalation({}, '2026-02-14T00:09:40.000Z')],
      agents: [buildAgent({ status: 'terminated' })],
      liveSessionNames: new Set<string>(),
      nowMs: Date.parse('2026-02-14T00:10:00.000Z'),
      staleAfterMs: 60_000,
    });

    expect(stale).toHaveLength(0);
  });
});
