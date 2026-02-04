import type { Database } from 'sql.js';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run, type EscalationRow } from '../client.js';

export type { EscalationRow };

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

export function createEscalation(db: Database, input: CreateEscalationInput): EscalationRow {
  const id = `ESC-${nanoid(6).toUpperCase()}`;
  const now = new Date().toISOString();

  run(db, `
    INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    id,
    input.storyId || null,
    input.fromAgentId || null,
    input.toAgentId || null,
    input.reason,
    now
  ]);

  return getEscalationById(db, id)!;
}

export function getEscalationById(db: Database, id: string): EscalationRow | undefined {
  return queryOne<EscalationRow>(db, 'SELECT * FROM escalations WHERE id = ?', [id]);
}

export function getEscalationsByStory(db: Database, storyId: string): EscalationRow[] {
  return queryAll<EscalationRow>(db, `
    SELECT * FROM escalations
    WHERE story_id = ?
    ORDER BY created_at DESC
  `, [storyId]);
}

export function getEscalationsByFromAgent(db: Database, agentId: string): EscalationRow[] {
  return queryAll<EscalationRow>(db, `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    ORDER BY created_at DESC
  `, [agentId]);
}

export function getEscalationsByToAgent(db: Database, agentId: string | null): EscalationRow[] {
  if (agentId === null) {
    return queryAll<EscalationRow>(db, `
      SELECT * FROM escalations
      WHERE to_agent_id IS NULL
      ORDER BY created_at DESC
    `);
  }
  return queryAll<EscalationRow>(db, `
    SELECT * FROM escalations
    WHERE to_agent_id = ?
    ORDER BY created_at DESC
  `, [agentId]);
}

export function getEscalationsByStatus(db: Database, status: EscalationStatus): EscalationRow[] {
  return queryAll<EscalationRow>(db, `
    SELECT * FROM escalations
    WHERE status = ?
    ORDER BY created_at DESC
  `, [status]);
}

export function getPendingEscalations(db: Database): EscalationRow[] {
  return getEscalationsByStatus(db, 'pending');
}

export function getPendingHumanEscalations(db: Database): EscalationRow[] {
  return queryAll<EscalationRow>(db, `
    SELECT * FROM escalations
    WHERE status = 'pending' AND to_agent_id IS NULL
    ORDER BY created_at
  `);
}

export function getAllEscalations(db: Database): EscalationRow[] {
  return queryAll<EscalationRow>(db, 'SELECT * FROM escalations ORDER BY created_at DESC');
}

export function updateEscalation(db: Database, id: string, input: UpdateEscalationInput): EscalationRow | undefined {
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
    if (input.status === 'resolved') {
      updates.push('resolved_at = ?');
      values.push(new Date().toISOString());
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
  run(db, `UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`, values);
  return getEscalationById(db, id);
}

export function resolveEscalation(db: Database, id: string, resolution: string): EscalationRow | undefined {
  return updateEscalation(db, id, { status: 'resolved', resolution });
}

export function acknowledgeEscalation(db: Database, id: string): EscalationRow | undefined {
  return updateEscalation(db, id, { status: 'acknowledged' });
}

export function deleteEscalation(db: Database, id: string): void {
  run(db, 'DELETE FROM escalations WHERE id = ?', [id]);
}
