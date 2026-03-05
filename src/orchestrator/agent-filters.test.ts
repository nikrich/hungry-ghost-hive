// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';

import type { AgentRow } from '../db/queries/agents.js';
import {
  countOfType,
  getActiveOfType,
  getAssignableAgents,
  getIdleOfType,
} from './agent-filters.js';

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    type: 'senior',
    team_id: 'team-1',
    tmux_session: null,
    model: null,
    status: 'idle',
    current_story_id: null,
    memory_state: null,
    last_seen: null,
    cli_tool: 'claude',
    worktree_path: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  };
}

describe('getAssignableAgents', () => {
  it('includes idle non-qa/non-auditor agents', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'senior', status: 'idle' }),
      makeAgent({ id: 'a2', type: 'intermediate', status: 'idle' }),
      makeAgent({ id: 'a3', type: 'junior', status: 'idle' }),
    ];
    expect(getAssignableAgents(agents)).toHaveLength(3);
  });

  it('includes working agents with no current story', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'senior', status: 'working', current_story_id: null }),
    ];
    expect(getAssignableAgents(agents)).toHaveLength(1);
  });

  it('excludes working agents with a current story', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'senior', status: 'working', current_story_id: 'story-1' }),
    ];
    expect(getAssignableAgents(agents)).toHaveLength(0);
  });

  it('excludes qa and auditor agents', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'qa', status: 'idle' }),
      makeAgent({ id: 'a2', type: 'auditor', status: 'idle' }),
      makeAgent({ id: 'a3', type: 'senior', status: 'idle' }),
    ];
    const result = getAssignableAgents(agents);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a3');
  });

  it('excludes terminated agents', () => {
    const agents = [makeAgent({ id: 'a1', type: 'senior', status: 'terminated' })];
    expect(getAssignableAgents(agents)).toHaveLength(0);
  });
});

describe('getActiveOfType', () => {
  it('returns agents of the specified type that are not terminated', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'senior', status: 'idle' }),
      makeAgent({ id: 'a2', type: 'senior', status: 'working' }),
      makeAgent({ id: 'a3', type: 'senior', status: 'terminated' }),
      makeAgent({ id: 'a4', type: 'junior', status: 'idle' }),
    ];
    const result = getActiveOfType(agents, 'senior');
    expect(result).toHaveLength(2);
    expect(result.map(a => a.id)).toEqual(['a1', 'a2']);
  });

  it('returns empty array when no matches', () => {
    const agents = [makeAgent({ id: 'a1', type: 'junior', status: 'idle' })];
    expect(getActiveOfType(agents, 'senior')).toHaveLength(0);
  });
});

describe('getIdleOfType', () => {
  it('returns only idle agents of the specified type', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'intermediate', status: 'idle' }),
      makeAgent({ id: 'a2', type: 'intermediate', status: 'working' }),
      makeAgent({ id: 'a3', type: 'senior', status: 'idle' }),
    ];
    const result = getIdleOfType(agents, 'intermediate');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });
});

describe('countOfType', () => {
  it('counts all agents of the specified type regardless of status', () => {
    const agents = [
      makeAgent({ id: 'a1', type: 'junior', status: 'idle' }),
      makeAgent({ id: 'a2', type: 'junior', status: 'terminated' }),
      makeAgent({ id: 'a3', type: 'senior', status: 'idle' }),
    ];
    expect(countOfType(agents, 'junior')).toBe(2);
  });

  it('returns 0 when no agents of that type', () => {
    const agents = [makeAgent({ id: 'a1', type: 'senior', status: 'idle' })];
    expect(countOfType(agents, 'qa')).toBe(0);
  });
});
