// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type AgentLogRow } from '../client.js';

export type { AgentLogRow };

export type EventType =
  | 'AGENT_SPAWNED'
  | 'AGENT_SPAWN_FAILED'
  | 'AGENT_TERMINATED'
  | 'AGENT_RESUMED'
  | 'AGENT_CHECKPOINT'
  | 'WORKTREE_REMOVAL_FAILED'
  | 'REQUIREMENT_RECEIVED'
  | 'PLANNING_STARTED'
  | 'PLANNING_COMPLETED'
  | 'STORY_CREATED'
  | 'STORY_ESTIMATED'
  | 'STORY_ASSIGNED'
  | 'STORY_STARTED'
  | 'STORY_PROGRESS_UPDATE'
  | 'STORY_COMPLETED'
  | 'STORY_REVIEW_REQUESTED'
  | 'STORY_QA_STARTED'
  | 'STORY_QA_PASSED'
  | 'STORY_QA_FAILED'
  | 'STORY_PR_CREATED'
  | 'STORY_MERGED'
  | 'DUPLICATE_ASSIGNMENT_PREVENTED'
  | 'ORPHANED_STORY_RECOVERED'
  | 'CODEBASE_SWEEP_STARTED'
  | 'CODEBASE_SWEEP_COMPLETED'
  | 'BUILD_STARTED'
  | 'BUILD_PASSED'
  | 'BUILD_FAILED'
  | 'CODE_QUALITY_CHECK_STARTED'
  | 'CODE_QUALITY_CHECK_PASSED'
  | 'CODE_QUALITY_CHECK_FAILED'
  | 'ESCALATION_CREATED'
  | 'ESCALATION_RESOLVED'
  | 'TEAM_SCALED_UP'
  | 'TEAM_SCALED_DOWN'
  | 'QA_SPAWNED'
  | 'PR_SUBMITTED'
  | 'PR_REVIEW_STARTED'
  | 'PR_APPROVED'
  | 'PR_MERGED'
  | 'PR_REJECTED'
  | 'PR_CLOSED'
  | 'PR_MERGE_FAILED'
  | 'PR_MERGE_SKIPPED'
  | 'JIRA_SYNC_STARTED'
  | 'JIRA_SYNC_COMPLETED'
  | 'JIRA_SYNC_WARNING'
  | 'JIRA_EPIC_CREATED'
  | 'JIRA_STORY_CREATED'
  | 'JIRA_TRANSITION_SUCCESS'
  | 'JIRA_TRANSITION_FAILED'
  | 'JIRA_BOARD_POLL_STARTED'
  | 'JIRA_BOARD_POLL_COMPLETED'
  | 'JIRA_EPIC_INGESTED'
  | 'JIRA_ASSIGNMENT_REPAIRED'
  | 'JIRA_ASSIGNMENT_REPAIR_FAILED'
  | 'APPROACH_POSTED';

export interface CreateLogInput {
  agentId: string;
  storyId?: string | null;
  eventType: EventType;
  status?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

function inferAgentType(agentId: string): 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa' {
  const normalized = agentId.toLowerCase();
  if (normalized.includes('qa')) return 'qa';
  if (normalized.includes('senior')) return 'senior';
  if (normalized.includes('intermediate')) return 'intermediate';
  if (normalized.includes('junior')) return 'junior';
  return 'tech_lead';
}

function ensureLogAgentExists(db: Database, agentId: string): void {
  const existing = queryOne<{ id: string }>(db, 'SELECT id FROM agents WHERE id = ?', [agentId]);
  if (existing?.id) return;

  const now = new Date().toISOString();
  run(
    db,
    `
    INSERT INTO agents (id, type, status, created_at, updated_at, last_seen)
    VALUES (?, ?, 'terminated', ?, ?, ?)
  `,
    [agentId, inferAgentType(agentId), now, now, now]
  );
}

function resolveLogAgentId(db: Database, rawAgentId: string): string {
  const direct = queryOne<{ id: string }>(db, 'SELECT id FROM agents WHERE id = ?', [rawAgentId]);
  if (direct?.id) return direct.id;

  // Many call-sites provide tmux session names (for example: "hive-qa-team-1").
  // Prefer resolving those back to canonical agent IDs so logs remain linked.
  const bySession = queryOne<{ id: string }>(
    db,
    'SELECT id FROM agents WHERE tmux_session = ? ORDER BY updated_at DESC LIMIT 1',
    [rawAgentId]
  );
  if (bySession?.id) return bySession.id;

  // Last resort: create a lightweight synthetic agent row for system/session actors
  // like "manager" or "scheduler" so FK constraints cannot fail logging.
  ensureLogAgentExists(db, rawAgentId);
  return rawAgentId;
}

function resolveLogStoryId(db: Database, storyId?: string | null): string | null {
  if (!storyId) return null;
  const story = queryOne<{ id: string }>(db, 'SELECT id FROM stories WHERE id = ?', [storyId]);
  return story?.id || null;
}

export function createLog(db: Database, input: CreateLogInput): AgentLogRow {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  const now = new Date().toISOString();
  const resolvedAgentId = resolveLogAgentId(db, input.agentId);
  const resolvedStoryId = resolveLogStoryId(db, input.storyId);

  run(
    db,
    `
    INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    [
      resolvedAgentId,
      resolvedStoryId,
      input.eventType,
      input.status || null,
      input.message || null,
      metadata,
      now,
    ]
  );

  // Get the last inserted row
  const result = queryOne<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  return getLogById(db, result?.id || 0)!;
}

export function getLogById(db: Database, id: number): AgentLogRow | undefined {
  return queryOne<AgentLogRow>(db, 'SELECT * FROM agent_logs WHERE id = ?', [id]);
}

export function getLogsByAgent(db: Database, agentId: string, limit = 100): AgentLogRow[] {
  return queryAll<AgentLogRow>(
    db,
    `
    SELECT * FROM agent_logs
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    [agentId, limit]
  );
}

export function getLogsByStory(db: Database, storyId: string): AgentLogRow[] {
  return queryAll<AgentLogRow>(
    db,
    `
    SELECT * FROM agent_logs
    WHERE story_id = ?
    ORDER BY timestamp DESC
  `,
    [storyId]
  );
}

export function getLogsByEventType(db: Database, eventType: EventType, limit = 100): AgentLogRow[] {
  return queryAll<AgentLogRow>(
    db,
    `
    SELECT * FROM agent_logs
    WHERE event_type = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    [eventType, limit]
  );
}

export function getRecentLogs(db: Database, limit = 50): AgentLogRow[] {
  return queryAll<AgentLogRow>(
    db,
    `
    SELECT * FROM agent_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    [limit]
  );
}

export function getLogsSince(db: Database, since: string): AgentLogRow[] {
  return queryAll<AgentLogRow>(
    db,
    `
    SELECT * FROM agent_logs
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `,
    [since]
  );
}

export function countQaFailuresByStory(db: Database, storyId: string): number {
  const result = queryOne<{ count: number }>(
    db,
    `
    SELECT COUNT(*) as count
    FROM agent_logs
    WHERE story_id = ? AND event_type = 'STORY_QA_FAILED'
  `,
    [storyId]
  );
  return result?.count || 0;
}

export function pruneOldLogs(db: Database, retentionDays: number): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoff = cutoffDate.toISOString();

  // Get count before delete
  const before = queryOne<{ count: number }>(
    db,
    `
    SELECT COUNT(*) as count FROM agent_logs WHERE timestamp < ?
  `,
    [cutoff]
  );

  run(db, `DELETE FROM agent_logs WHERE timestamp < ?`, [cutoff]);

  return before?.count || 0;
}
