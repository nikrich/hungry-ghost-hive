import type { Database } from 'sql.js';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run, type AgentRow } from '../client.js';

export type { AgentRow };

export type AgentType = 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'terminated';

export interface CreateAgentInput {
  type: AgentType;
  teamId?: string | null;
  tmuxSession?: string | null;
  model?: string | null;
}

export interface UpdateAgentInput {
  status?: AgentStatus;
  tmuxSession?: string | null;
  currentStoryId?: string | null;
  memoryState?: string | null;
}

export function createAgent(db: Database, input: CreateAgentInput): AgentRow {
  const id = input.type === 'tech_lead'
    ? 'tech-lead'
    : `${input.type}-${nanoid(8)}`;
  const now = new Date().toISOString();

  run(db, `
    INSERT INTO agents (id, type, team_id, tmux_session, model, status, created_at, updated_at, last_seen)
    VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?)
  `, [id, input.type, input.teamId || null, input.tmuxSession || null, input.model || null, now, now, now]);

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
  return queryAll<AgentRow>(db, `
    SELECT * FROM agents
    WHERE status IN ('idle', 'working', 'blocked')
    ORDER BY type, team_id
  `);
}

export function getTechLead(db: Database): AgentRow | undefined {
  return queryOne<AgentRow>(db, `SELECT * FROM agents WHERE type = 'tech_lead'`);
}

export function updateAgent(db: Database, id: string, input: UpdateAgentInput): AgentRow | undefined {
  const updates: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [new Date().toISOString()];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.tmuxSession !== undefined) {
    updates.push('tmux_session = ?');
    values.push(input.tmuxSession);
  }
  if (input.currentStoryId !== undefined) {
    updates.push('current_story_id = ?');
    values.push(input.currentStoryId);
  }
  if (input.memoryState !== undefined) {
    updates.push('memory_state = ?');
    values.push(input.memoryState);
  }

  if (updates.length === 1) {
    // Only updated_at, nothing to update
    return getAgentById(db, id);
  }

  values.push(id);
  run(db, `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);
  return getAgentById(db, id);
}

export function deleteAgent(db: Database, id: string): void {
  run(db, 'DELETE FROM agents WHERE id = ?', [id]);
}

export function terminateAgent(db: Database, id: string): void {
  updateAgent(db, id, { status: 'terminated', tmuxSession: null });
}
