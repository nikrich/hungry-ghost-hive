import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

// Re-export EscalationRow for convenience
export type { EscalationRow } from '../client.js';
import type { EscalationRow } from '../client.js';

export type EscalationStatus = 'pending' | 'acknowledged' | 'resolved';

export interface CreateEscalationInput {
  storyId?: string | null;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  reason: string;
}

export interface UpdateEscalationInput {
  status?: EscalationStatus;
  toAgentId?: string | null;
  resolution?: string | null;
}

export function createEscalation(db: Database.Database, input: CreateEscalationInput): EscalationRow {
  const id = `ESC-${nanoid(6).toUpperCase()}`;

  const stmt = db.prepare(`
    INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    input.storyId || null,
    input.fromAgentId || null,
    input.toAgentId || null,
    input.reason
  );
  return getEscalationById(db, id)!;
}

export function getEscalationById(db: Database.Database, id: string): EscalationRow | undefined {
  return db.prepare('SELECT * FROM escalations WHERE id = ?').get(id) as EscalationRow | undefined;
}

export function getEscalationsByStory(db: Database.Database, storyId: string): EscalationRow[] {
  return db.prepare(`
    SELECT * FROM escalations
    WHERE story_id = ?
    ORDER BY created_at DESC
  `).all(storyId) as EscalationRow[];
}

export function getEscalationsByFromAgent(db: Database.Database, agentId: string): EscalationRow[] {
  return db.prepare(`
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    ORDER BY created_at DESC
  `).all(agentId) as EscalationRow[];
}

export function getEscalationsByToAgent(db: Database.Database, agentId: string | null): EscalationRow[] {
  if (agentId === null) {
    return db.prepare(`
      SELECT * FROM escalations
      WHERE to_agent_id IS NULL
      ORDER BY created_at DESC
    `).all() as EscalationRow[];
  }
  return db.prepare(`
    SELECT * FROM escalations
    WHERE to_agent_id = ?
    ORDER BY created_at DESC
  `).all(agentId) as EscalationRow[];
}

export function getEscalationsByStatus(db: Database.Database, status: EscalationStatus): EscalationRow[] {
  return db.prepare(`
    SELECT * FROM escalations
    WHERE status = ?
    ORDER BY created_at DESC
  `).all(status) as EscalationRow[];
}

export function getPendingEscalations(db: Database.Database): EscalationRow[] {
  return getEscalationsByStatus(db, 'pending');
}

export function getPendingHumanEscalations(db: Database.Database): EscalationRow[] {
  return db.prepare(`
    SELECT * FROM escalations
    WHERE status = 'pending' AND to_agent_id IS NULL
    ORDER BY created_at
  `).all() as EscalationRow[];
}

export function getAllEscalations(db: Database.Database): EscalationRow[] {
  return db.prepare('SELECT * FROM escalations ORDER BY created_at DESC').all() as EscalationRow[];
}

export function updateEscalation(db: Database.Database, id: string, input: UpdateEscalationInput): EscalationRow | undefined {
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
    if (input.status === 'resolved') {
      updates.push('resolved_at = CURRENT_TIMESTAMP');
    }
  }
  if (input.toAgentId !== undefined) {
    updates.push('to_agent_id = ?');
    values.push(input.toAgentId);
  }
  if (input.resolution !== undefined) {
    updates.push('resolution = ?');
    values.push(input.resolution);
  }

  if (updates.length === 0) {
    return getEscalationById(db, id);
  }

  values.push(id);
  db.prepare(`UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getEscalationById(db, id);
}

export function resolveEscalation(db: Database.Database, id: string, resolution: string): EscalationRow | undefined {
  return updateEscalation(db, id, { status: 'resolved', resolution });
}

export function acknowledgeEscalation(db: Database.Database, id: string): EscalationRow | undefined {
  return updateEscalation(db, id, { status: 'acknowledged' });
}

export function deleteEscalation(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM escalations WHERE id = ?').run(id);
}
