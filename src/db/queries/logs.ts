// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { AgentLogRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

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
  | 'PR_SYNC_SKIPPED'
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
  | 'APPROACH_POSTED'
  | 'FEATURE_BRANCH_CREATED'
  | 'FEATURE_BRANCH_FAILED'
  | 'FEATURE_TEST_SPAWNED'
  | 'FEATURE_SIGN_OFF_TRIGGERED'
  | 'FEATURE_SIGN_OFF_PASSED'
  | 'FEATURE_SIGN_OFF_FAILED';

export interface CreateLogInput {
  agentId: string;
  storyId?: string | null;
  eventType: EventType;
  status?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

function inferAgentType(
  agentId: string
): 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa' {
  const normalized = agentId.toLowerCase();
  if (normalized.includes('qa')) return 'qa';
  if (normalized.includes('senior')) return 'senior';
  if (normalized.includes('intermediate')) return 'intermediate';
  if (normalized.includes('junior')) return 'junior';
  return 'tech_lead';
}

function getAgentColumnNames(provider: DatabaseProvider): Set<string> {
  const rows = provider.queryAll<{ name: string }>('PRAGMA table_info(agents)');
  const columnNames = new Set<string>();
  for (const row of rows) {
    columnNames.add(row.name);
  }
  return columnNames;
}

function ensureLogAgentExists(provider: DatabaseProvider, agentId: string): void {
  const existing = provider.queryOne<{ id: string }>('SELECT id FROM agents WHERE id = ?', [
    agentId,
  ]);
  if (existing?.id) return;

  const columns = getAgentColumnNames(provider);
  const now = new Date().toISOString();
  const insertColumns: string[] = ['id'];
  const insertValues: (string | null)[] = [agentId];

  if (columns.has('type')) {
    insertColumns.push('type');
    insertValues.push(inferAgentType(agentId));
  }
  if (columns.has('status')) {
    insertColumns.push('status');
    insertValues.push('terminated');
  }
  if (columns.has('created_at')) {
    insertColumns.push('created_at');
    insertValues.push(now);
  }
  if (columns.has('updated_at')) {
    insertColumns.push('updated_at');
    insertValues.push(now);
  }
  if (columns.has('last_seen')) {
    insertColumns.push('last_seen');
    insertValues.push(now);
  }

  const placeholders = insertColumns.map(() => '?').join(', ');
  provider.run(
    `
    INSERT OR IGNORE INTO agents (${insertColumns.join(', ')})
    VALUES (${placeholders})
  `,
    insertValues
  );
}

function resolveLogAgentId(provider: DatabaseProvider, rawAgentId: string): string {
  const direct = provider.queryOne<{ id: string }>('SELECT id FROM agents WHERE id = ?', [
    rawAgentId,
  ]);
  if (direct?.id) return direct.id;

  const columns = getAgentColumnNames(provider);

  // Many call-sites provide tmux session names (for example: "hive-qa-team-1").
  // Prefer resolving those back to canonical agent IDs so logs remain linked.
  if (columns.has('tmux_session')) {
    const bySession = provider.queryOne<{ id: string }>(
      `SELECT id FROM agents WHERE tmux_session = ?${
        columns.has('updated_at') ? ' ORDER BY updated_at DESC' : ''
      } LIMIT 1`,
      [rawAgentId]
    );
    if (bySession?.id) return bySession.id;
  }

  // Last resort: create a lightweight synthetic agent row for system/session actors
  // like "manager" or "scheduler" so FK constraints cannot fail logging.
  ensureLogAgentExists(provider, rawAgentId);
  return rawAgentId;
}

function resolveLogStoryId(provider: DatabaseProvider, storyId?: string | null): string | null {
  if (!storyId) return null;
  const story = provider.queryOne<{ id: string }>('SELECT id FROM stories WHERE id = ?', [storyId]);
  return story?.id || null;
}

export function createLog(provider: DatabaseProvider, input: CreateLogInput): AgentLogRow {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  const now = new Date().toISOString();
  const resolvedAgentId = resolveLogAgentId(provider, input.agentId);
  const resolvedStoryId = resolveLogStoryId(provider, input.storyId);

  provider.run(
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
  const result = provider.queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  return getLogById(provider, result?.id || 0)!;
}

export function getLogById(provider: DatabaseProvider, id: number): AgentLogRow | undefined {
  return provider.queryOne<AgentLogRow>('SELECT * FROM agent_logs WHERE id = ?', [id]);
}

export function getLogsByAgent(
  provider: DatabaseProvider,
  agentId: string,
  limit = 100
): AgentLogRow[] {
  return provider.queryAll<AgentLogRow>(
    `
    SELECT * FROM agent_logs
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    [agentId, limit]
  );
}

export function getLogsByStory(provider: DatabaseProvider, storyId: string): AgentLogRow[] {
  return provider.queryAll<AgentLogRow>(
    `
    SELECT * FROM agent_logs
    WHERE story_id = ?
    ORDER BY timestamp DESC
  `,
    [storyId]
  );
}

export function getLogsByEventType(
  provider: DatabaseProvider,
  eventType: EventType,
  limit = 100
): AgentLogRow[] {
  return provider.queryAll<AgentLogRow>(
    `
    SELECT * FROM agent_logs
    WHERE event_type = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    [eventType, limit]
  );
}

export function getRecentLogs(provider: DatabaseProvider, limit = 50): AgentLogRow[] {
  return provider.queryAll<AgentLogRow>(
    `
    SELECT * FROM agent_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `,
    [limit]
  );
}

export function getLogsSince(provider: DatabaseProvider, since: string): AgentLogRow[] {
  return provider.queryAll<AgentLogRow>(
    `
    SELECT * FROM agent_logs
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `,
    [since]
  );
}

export function countQaFailuresByStory(provider: DatabaseProvider, storyId: string): number {
  const result = provider.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count
    FROM agent_logs
    WHERE story_id = ? AND event_type = 'STORY_QA_FAILED'
  `,
    [storyId]
  );
  return result?.count || 0;
}

export function pruneOldLogs(provider: DatabaseProvider, retentionDays: number): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoff = cutoffDate.toISOString();

  // Get count before delete
  const before = provider.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count FROM agent_logs WHERE timestamp < ?
  `,
    [cutoff]
  );

  provider.run(`DELETE FROM agent_logs WHERE timestamp < ?`, [cutoff]);

  return before?.count || 0;
}
