import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

// Re-export RequirementRow for convenience
export type { RequirementRow } from '../client.js';
import type { RequirementRow } from '../client.js';

export type RequirementStatus = 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';

export interface CreateRequirementInput {
  title: string;
  description: string;
  submittedBy?: string;
}

export interface UpdateRequirementInput {
  title?: string;
  description?: string;
  status?: RequirementStatus;
}

export function createRequirement(db: Database.Database, input: CreateRequirementInput): RequirementRow {
  const id = `REQ-${nanoid(8).toUpperCase()}`;
  const stmt = db.prepare(`
    INSERT INTO requirements (id, title, description, submitted_by)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, input.title, input.description, input.submittedBy || 'human');
  return getRequirementById(db, id)!;
}

export function getRequirementById(db: Database.Database, id: string): RequirementRow | undefined {
  return db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow | undefined;
}

export function getAllRequirements(db: Database.Database): RequirementRow[] {
  return db.prepare('SELECT * FROM requirements ORDER BY created_at DESC').all() as RequirementRow[];
}

export function getRequirementsByStatus(db: Database.Database, status: RequirementStatus): RequirementRow[] {
  return db.prepare('SELECT * FROM requirements WHERE status = ? ORDER BY created_at DESC').all(status) as RequirementRow[];
}

export function getPendingRequirements(db: Database.Database): RequirementRow[] {
  return db.prepare(`
    SELECT * FROM requirements
    WHERE status IN ('pending', 'planning', 'in_progress')
    ORDER BY created_at
  `).all() as RequirementRow[];
}

export function updateRequirement(db: Database.Database, id: string, input: UpdateRequirementInput): RequirementRow | undefined {
  const updates: string[] = [];
  const values: string[] = [];

  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(input.title);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }

  if (updates.length === 0) {
    return getRequirementById(db, id);
  }

  values.push(id);
  db.prepare(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getRequirementById(db, id);
}

export function deleteRequirement(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
}
