// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import type { EscalationRow } from '../../../db/client.js';
import { findStoryStateEscalationsToResolve, type StoryStateSnapshot } from './story-state-escalations.js';

function buildEscalation(overrides: Partial<EscalationRow> = {}): EscalationRow {
  return {
    id: 'ESC-TEST',
    story_id: 'STORY-123',
    from_agent_id: 'hive-junior-team-1',
    to_agent_id: null,
    reason: 'AI done=false escalation: manager AI assessment returned done=false for STORY-123',
    status: 'pending',
    resolution: null,
    created_at: '2026-02-21T00:00:00.000Z',
    resolved_at: null,
    ...overrides,
  };
}

function buildStory(overrides: Partial<StoryStateSnapshot> = {}): StoryStateSnapshot {
  return {
    id: 'STORY-123',
    status: 'in_progress',
    assignedSessionName: 'hive-junior-team-1',
    ...overrides,
  };
}

describe('findStoryStateEscalationsToResolve', () => {
  it('resolves done-false escalation when story status advanced', () => {
    const escalations = [buildEscalation()];
    const storyById = new Map<string, StoryStateSnapshot>([
      ['STORY-123', buildStory({ status: 'pr_submitted' })],
    ]);

    const result = findStoryStateEscalationsToResolve({ pendingEscalations: escalations, storyById });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('status advanced to pr_submitted');
  });

  it('resolves classifier-timeout escalation when story is missing', () => {
    const escalations = [
      buildEscalation({
        reason: 'Classifier timeout: manager completion classifier timed out for STORY-123',
      }),
    ];

    const result = findStoryStateEscalationsToResolve({
      pendingEscalations: escalations,
      storyById: new Map(),
    });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('no longer exists');
  });

  it('does not resolve non story-state escalations', () => {
    const escalations = [
      buildEscalation({
        reason: 'Approval required (codex) in hive-junior-team-1: Asking a question',
      }),
    ];
    const storyById = new Map<string, StoryStateSnapshot>([
      ['STORY-123', buildStory({ status: 'pr_submitted' })],
    ]);

    const result = findStoryStateEscalationsToResolve({ pendingEscalations: escalations, storyById });
    expect(result).toHaveLength(0);
  });

  it('does not resolve when story is in_progress and escalation source matches assigned session', () => {
    const escalations = [buildEscalation()];
    const storyById = new Map<string, StoryStateSnapshot>([['STORY-123', buildStory()]]);

    const result = findStoryStateEscalationsToResolve({ pendingEscalations: escalations, storyById });
    expect(result).toHaveLength(0);
  });

  it('resolves when story is reassigned to a different session', () => {
    const escalations = [buildEscalation()];
    const storyById = new Map<string, StoryStateSnapshot>([
      ['STORY-123', buildStory({ assignedSessionName: 'hive-junior-team-9' })],
    ]);

    const result = findStoryStateEscalationsToResolve({ pendingEscalations: escalations, storyById });
    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('source hive-junior-team-1 is outdated');
  });

  it('resolves stale done-false escalation when same assigned session is actively running', () => {
    const escalations = [
      buildEscalation({
        created_at: '2026-02-21T10:00:00.000Z',
      }),
    ];
    const storyById = new Map<string, StoryStateSnapshot>([['STORY-123', buildStory()]]);

    const result = findStoryStateEscalationsToResolve({
      pendingEscalations: escalations,
      storyById,
      liveSessionNames: new Set(['hive-junior-team-1']),
      nowMs: Date.parse('2026-02-21T10:10:00.000Z'),
      minActiveAgeMs: 60_000,
    });

    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('pending done=false escalation is stale');
  });

  it('does not resolve fresh done-false escalation before active-age threshold', () => {
    const escalations = [
      buildEscalation({
        created_at: '2026-02-21T10:09:30.000Z',
      }),
    ];
    const storyById = new Map<string, StoryStateSnapshot>([['STORY-123', buildStory()]]);

    const result = findStoryStateEscalationsToResolve({
      pendingEscalations: escalations,
      storyById,
      liveSessionNames: new Set(['hive-junior-team-1']),
      nowMs: Date.parse('2026-02-21T10:10:00.000Z'),
      minActiveAgeMs: 60_000,
    });

    expect(result).toHaveLength(0);
  });

  it('does not auto-resolve classifier-timeout escalation in same active session', () => {
    const escalations = [
      buildEscalation({
        reason: 'Classifier timeout: manager completion classifier timed out for STORY-123',
        created_at: '2026-02-21T10:00:00.000Z',
      }),
    ];
    const storyById = new Map<string, StoryStateSnapshot>([['STORY-123', buildStory()]]);

    const result = findStoryStateEscalationsToResolve({
      pendingEscalations: escalations,
      storyById,
      liveSessionNames: new Set(['hive-junior-team-1']),
      nowMs: Date.parse('2026-02-21T10:10:00.000Z'),
      minActiveAgeMs: 60_000,
    });

    expect(result).toHaveLength(0);
  });
});
