import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type AgentLogRow } from '../client.js';

export type { AgentLogRow };

export type EventType =
  | 'AGENT_SPAWNED'
  | 'AGENT_TERMINATED'
  | 'AGENT_RESUMED'
  | 'AGENT_CHECKPOINT'
  | 'REQUIREMENT_RECEIVED'
  | 'PLANNING_STARTED'
  | 'PLANNING_COMPLETED'
  | 'STORY_CREATED'
  | 'STORY_ESTIMATED'
  | 'STORY_ASSIGNED'
  | 'STORY_SKIPPED'
  | 'STORY_STARTED'
  | 'STORY_PROGRESS_UPDATE'
  | 'STORY_COMPLETED'
  | 'STORY_REVIEW_REQUESTED'
  | 'STORY_QA_STARTED'
  | 'STORY_QA_PASSED'
  | 'STORY_QA_FAILED'
  | 'STORY_PR_CREATED'
  | 'STORY_MERGED'
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
  | 'PR_REJECTED';

export interface CreateLogInput {
  agentId: string;
  storyId?: string | null;
  eventType: EventType;
  status?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function createLog(db: Database, input: CreateLogInput): AgentLogRow {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  const now = new Date().toISOString();

  run(db, `
    INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    input.agentId,
    input.storyId || null,
    input.eventType,
    input.status || null,
    input.message || null,
    metadata,
    now
  ]);

  // Get the last inserted row
  const result = queryOne<{ id: number }>(db, 'SELECT last_insert_rowid() as id');
  return getLogById(db, result?.id || 0)!;
}

export function getLogById(db: Database, id: number): AgentLogRow | undefined {
  return queryOne<AgentLogRow>(db, 'SELECT * FROM agent_logs WHERE id = ?', [id]);
}

export function getLogsByAgent(db: Database, agentId: string, limit = 100): AgentLogRow[] {
  return queryAll<AgentLogRow>(db, `
    SELECT * FROM agent_logs
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `, [agentId, limit]);
}

export function getLogsByStory(db: Database, storyId: string): AgentLogRow[] {
  return queryAll<AgentLogRow>(db, `
    SELECT * FROM agent_logs
    WHERE story_id = ?
    ORDER BY timestamp DESC
  `, [storyId]);
}

export function getLogsByEventType(db: Database, eventType: EventType, limit = 100): AgentLogRow[] {
  return queryAll<AgentLogRow>(db, `
    SELECT * FROM agent_logs
    WHERE event_type = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `, [eventType, limit]);
}

export function getRecentLogs(db: Database, limit = 50): AgentLogRow[] {
  return queryAll<AgentLogRow>(db, `
    SELECT * FROM agent_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit]);
}

export function getLogsSince(db: Database, since: string): AgentLogRow[] {
  return queryAll<AgentLogRow>(db, `
    SELECT * FROM agent_logs
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `, [since]);
}

export function pruneOldLogs(db: Database, retentionDays: number): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoff = cutoffDate.toISOString();

  // Get count before delete
  const before = queryOne<{ count: number }>(db, `
    SELECT COUNT(*) as count FROM agent_logs WHERE timestamp < ?
  `, [cutoff]);

  run(db, `DELETE FROM agent_logs WHERE timestamp < ?`, [cutoff]);

  return before?.count || 0;
}
