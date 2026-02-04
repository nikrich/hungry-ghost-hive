import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

// Re-export AgentRow for convenience
export type { AgentRow } from '../client.js';
import type { AgentRow } from '../client.js';

export type AgentType = 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'terminated';

export interface CreateAgentInput {
  type: AgentType;
  teamId?: string | null;
  tmuxSession?: string | null;
}

export interface UpdateAgentInput {
  status?: AgentStatus;
  tmuxSession?: string | null;
  currentStoryId?: string | null;
  memoryState?: string | null;
}

export function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow {
  const id = input.type === 'tech_lead'
    ? 'tech-lead'
    : `${input.type}-${nanoid(8)}`;

  const stmt = db.prepare(`
    INSERT INTO agents (id, type, team_id, tmux_session, status)
    VALUES (?, ?, ?, ?, 'idle')
  `);
  stmt.run(id, input.type, input.teamId || null, input.tmuxSession || null);
  return getAgentById(db, id)!;
}

export function getAgentById(db: Database.Database, id: string): AgentRow | undefined {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined;
}

export function getAgentsByTeam(db: Database.Database, teamId: string): AgentRow[] {
  return db.prepare('SELECT * FROM agents WHERE team_id = ?').all(teamId) as AgentRow[];
}

export function getAgentsByType(db: Database.Database, type: AgentType): AgentRow[] {
  return db.prepare('SELECT * FROM agents WHERE type = ?').all(type) as AgentRow[];
}

export function getAgentsByStatus(db: Database.Database, status: AgentStatus): AgentRow[] {
  return db.prepare('SELECT * FROM agents WHERE status = ?').all(status) as AgentRow[];
}

export function getAllAgents(db: Database.Database): AgentRow[] {
  return db.prepare('SELECT * FROM agents ORDER BY type, team_id').all() as AgentRow[];
}

export function getActiveAgents(db: Database.Database): AgentRow[] {
  return db.prepare(`
    SELECT * FROM agents
    WHERE status IN ('idle', 'working', 'blocked')
    ORDER BY type, team_id
  `).all() as AgentRow[];
}

export function getTechLead(db: Database.Database): AgentRow | undefined {
  return db.prepare(`SELECT * FROM agents WHERE type = 'tech_lead'`).get() as AgentRow | undefined;
}

export function updateAgent(db: Database.Database, id: string, input: UpdateAgentInput): AgentRow | undefined {
  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: (string | null)[] = [];

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
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getAgentById(db, id);
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

export function terminateAgent(db: Database.Database, id: string): void {
  updateAgent(db, id, { status: 'terminated', tmuxSession: null });
}
