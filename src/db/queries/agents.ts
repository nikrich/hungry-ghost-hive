// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type AgentRow } from '../client.js';
import { buildDynamicUpdate, type FieldMap } from '../utils/dynamic-update.js';

export type { AgentRow };

export type AgentType =
  | 'tech_lead'
  | 'senior'
  | 'intermediate'
  | 'junior'
  | 'qa'
  | 'feature_test'
  | 'auditor';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'terminated';

export interface CreateAgentInput {
  type: AgentType;
  teamId?: string | null;
  tmuxSession?: string | null;
  model?: string | null;
  worktreePath?: string | null;
}

export interface UpdateAgentInput {
  status?: AgentStatus;
  tmuxSession?: string | null;
  currentStoryId?: string | null;
  memoryState?: string | null;
  worktreePath?: string | null;
  createdAt?: string;
}

export function createAgent(db: Database, input: CreateAgentInput): AgentRow {
  const id = input.type === 'tech_lead' ? 'tech-lead' : `${input.type}-${nanoid(8)}`;
  const now = new Date().toISOString();

  run(
    db,
    `
    INSERT INTO agents (id, type, team_id, tmux_session, model, status, worktree_path, created_at, updated_at, last_seen)
    VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?)
  `,
    [
      id,
      input.type,
      input.teamId || null,
      input.tmuxSession || null,
      input.model || null,
      input.worktreePath || null,
      now,
      now,
      now,
    ]
  );

  return getAgentById(db, id)!;
}

export function getAgentById(db: Database, id: string): AgentRow | undefined {
  return queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', [id]);
}

export function getAgentsByTeam(db: Database, teamId: string): AgentRow[] {
  return queryAll<AgentRow>(db, 'SELECT * FROM agents WHERE team_id = ?', [teamId]);
}

export function getAgentsByType(db: Database, type: AgentType): AgentRow[] {
  return queryAll<AgentRow>(db, 'SELECT * FROM agents WHERE type = ?', [type]);
}

export function getAgentsByStatus(db: Database, status: AgentStatus): AgentRow[] {
  return queryAll<AgentRow>(db, 'SELECT * FROM agents WHERE status = ?', [status]);
}

export function getAllAgents(db: Database): AgentRow[] {
  return queryAll<AgentRow>(db, 'SELECT * FROM agents ORDER BY type, team_id');
}

export function getActiveAgents(db: Database): AgentRow[] {
  return queryAll<AgentRow>(
    db,
    `
    SELECT * FROM agents
    WHERE status IN ('idle', 'working', 'blocked')
    ORDER BY type, team_id
  `
  );
}

export function getTechLead(db: Database): AgentRow | undefined {
  return queryOne<AgentRow>(db, `SELECT * FROM agents WHERE type = 'tech_lead'`);
}

const agentFieldMap: FieldMap = {
  status: 'status',
  tmuxSession: 'tmux_session',
  currentStoryId: 'current_story_id',
  memoryState: 'memory_state',
  worktreePath: 'worktree_path',
  createdAt: 'created_at',
};

export function updateAgent(
  db: Database,
  id: string,
  input: UpdateAgentInput
): AgentRow | undefined {
  const { updates, values } = buildDynamicUpdate(input, agentFieldMap, { includeUpdatedAt: true });

  if (updates.length === 1) {
    return getAgentById(db, id);
  }

  values.push(id);
  run(db, `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);
  return getAgentById(db, id);
}

export function deleteAgent(db: Database, id: string): void {
  run(db, 'DELETE FROM agents WHERE id = ?', [id]);
}

export function getAgentByTmuxSession(db: Database, tmuxSession: string): AgentRow | undefined {
  return queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE tmux_session = ? LIMIT 1', [
    tmuxSession,
  ]);
}

export function terminateAgent(db: Database, id: string): void {
  updateAgent(db, id, { status: 'terminated', tmuxSession: null });
}
