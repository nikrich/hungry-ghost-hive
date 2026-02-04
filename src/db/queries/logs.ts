import type Database from 'better-sqlite3';

// Re-export AgentLogRow for convenience
export type { AgentLogRow } from '../client.js';
import type { AgentLogRow } from '../client.js';

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
  | 'TEAM_SCALED_DOWN';

export interface CreateLogInput {
  agentId: string;
  storyId?: string | null;
  eventType: EventType;
  status?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function createLog(db: Database.Database, input: CreateLogInput): AgentLogRow {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

  const stmt = db.prepare(`
    INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.agentId,
    input.storyId || null,
    input.eventType,
    input.status || null,
    input.message || null,
    metadata
  );

  return getLogById(db, Number(result.lastInsertRowid))!;
}

export function getLogById(db: Database.Database, id: number): AgentLogRow | undefined {
  return db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(id) as AgentLogRow | undefined;
}

export function getLogsByAgent(db: Database.Database, agentId: string, limit = 100): AgentLogRow[] {
  return db.prepare(`
    SELECT * FROM agent_logs
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(agentId, limit) as AgentLogRow[];
}

export function getLogsByStory(db: Database.Database, storyId: string): AgentLogRow[] {
  return db.prepare(`
    SELECT * FROM agent_logs
    WHERE story_id = ?
    ORDER BY timestamp DESC
  `).all(storyId) as AgentLogRow[];
}

export function getLogsByEventType(db: Database.Database, eventType: EventType, limit = 100): AgentLogRow[] {
  return db.prepare(`
    SELECT * FROM agent_logs
    WHERE event_type = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(eventType, limit) as AgentLogRow[];
}

export function getRecentLogs(db: Database.Database, limit = 50): AgentLogRow[] {
  return db.prepare(`
    SELECT * FROM agent_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as AgentLogRow[];
}

export function getLogsSince(db: Database.Database, since: string): AgentLogRow[] {
  return db.prepare(`
    SELECT * FROM agent_logs
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `).all(since) as AgentLogRow[];
}

export function pruneOldLogs(db: Database.Database, retentionDays: number): number {
  const result = db.prepare(`
    DELETE FROM agent_logs
    WHERE timestamp < datetime('now', '-' || ? || ' days')
  `).run(retentionDays);
  return result.changes;
}
