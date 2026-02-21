// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { AgentRow, PullRequestRow } from '../../../db/client.js';
import { findOrphanedReviewAssignments } from './review-assignment-recovery.js';

function buildPR(overrides: Partial<PullRequestRow> = {}): PullRequestRow {
  return {
    id: 'pr-1',
    story_id: 'STORY-1',
    team_id: 'team-1',
    branch_name: 'feature/STORY-1',
    github_pr_number: 123,
    github_pr_url: 'https://github.com/test/repo/pull/123',
    submitted_by: 'hive-junior-1',
    reviewed_by: 'hive-qa-1',
    status: 'reviewing',
    review_notes: null,
    created_at: '2026-02-21T00:00:00.000Z',
    updated_at: '2026-02-21T00:00:00.000Z',
    reviewed_at: null,
    ...overrides,
  };
}

function buildAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'qa-1',
    type: 'qa',
    team_id: 'team-1',
    tmux_session: 'hive-qa-1',
    model: 'gpt-5.1-codex-mini',
    status: 'idle',
    current_story_id: null,
    memory_state: null,
    last_seen: null,
    cli_tool: 'codex',
    worktree_path: null,
    created_at: '2026-02-21T00:00:00.000Z',
    updated_at: '2026-02-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('findOrphanedReviewAssignments', () => {
  it('does not mark reviewing PR as orphaned when reviewer session is live', () => {
    const result = findOrphanedReviewAssignments({
      openPRs: [buildPR()],
      liveSessionNames: new Set(['hive-qa-1']),
      agentsBySessionName: new Map(),
    });

    expect(result).toHaveLength(0);
  });

  it('does not mark reviewing PR as orphaned when reviewer is an agent id with live tmux session', () => {
    const agent = buildAgent();
    const result = findOrphanedReviewAssignments({
      openPRs: [buildPR({ reviewed_by: 'qa-1' })],
      liveSessionNames: new Set(['hive-qa-1']),
      agentsBySessionName: new Map([
        ['qa-1', agent],
        ['hive-qa-1', agent],
      ]),
    });

    expect(result).toHaveLength(0);
  });

  it('marks reviewing PR as orphaned when reviewer session is not live', () => {
    const result = findOrphanedReviewAssignments({
      openPRs: [buildPR({ reviewed_by: 'hive-qa-dead' })],
      liveSessionNames: new Set(['hive-junior-1']),
      agentsBySessionName: new Map(),
    });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('not live');
  });

  it('marks reviewing PR as orphaned when reviewer agent is terminated', () => {
    const deadAgent = buildAgent({ id: 'qa-dead', tmux_session: 'hive-qa-dead', status: 'terminated' });
    const result = findOrphanedReviewAssignments({
      openPRs: [buildPR({ reviewed_by: 'qa-dead' })],
      liveSessionNames: new Set(),
      agentsBySessionName: new Map([
        ['qa-dead', deadAgent],
        ['hive-qa-dead', deadAgent],
      ]),
    });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('terminated');
  });

  it('marks reviewing PR with missing reviewer as orphaned', () => {
    const result = findOrphanedReviewAssignments({
      openPRs: [buildPR({ reviewed_by: null })],
      liveSessionNames: new Set(),
      agentsBySessionName: new Map(),
    });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('no assigned reviewer');
  });

  it('ignores non-reviewing PR statuses', () => {
    const result = findOrphanedReviewAssignments({
      openPRs: [buildPR({ status: 'queued', reviewed_by: 'hive-qa-dead' })],
      liveSessionNames: new Set(),
      agentsBySessionName: new Map(),
    });

    expect(result).toHaveLength(0);
  });
});
