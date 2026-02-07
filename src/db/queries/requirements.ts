// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type RequirementRow } from '../client.js';

export type { RequirementRow };

export type RequirementStatus = 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';

export interface CreateRequirementInput {
  title: string;
  description: string;
  submittedBy?: string;
  godmode?: boolean;
}

export interface UpdateRequirementInput {
  title?: string;
  description?: string;
  status?: RequirementStatus;
  godmode?: boolean;
}

export function createRequirement(db: Database, input: CreateRequirementInput): RequirementRow {
  const id = `REQ-${nanoid(8).toUpperCase()}`;
  const now = new Date().toISOString();

  run(
    db,
    `
    INSERT INTO requirements (id, title, description, submitted_by, godmode, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    [id, input.title, input.description, input.submittedBy || 'human', input.godmode ? 1 : 0, now]
  );

  return getRequirementById(db, id)!;
}

export function getRequirementById(db: Database, id: string): RequirementRow | undefined {
  return queryOne<RequirementRow>(db, 'SELECT * FROM requirements WHERE id = ?', [id]);
}

export function getAllRequirements(db: Database): RequirementRow[] {
  return queryAll<RequirementRow>(
    db,
    'SELECT * FROM requirements ORDER BY created_at DESC, rowid DESC'
  );
}

export function getRequirementsByStatus(db: Database, status: RequirementStatus): RequirementRow[] {
  return queryAll<RequirementRow>(
    db,
    'SELECT * FROM requirements WHERE status = ? ORDER BY created_at DESC, rowid DESC',
    [status]
  );
}

export function getPendingRequirements(db: Database): RequirementRow[] {
  return queryAll<RequirementRow>(
    db,
    `
    SELECT * FROM requirements
    WHERE status IN ('pending', 'planning', 'in_progress')
    ORDER BY created_at, rowid
  `
  );
}

export function updateRequirement(
  db: Database,
  id: string,
  input: UpdateRequirementInput
): RequirementRow | undefined {
  const updates: string[] = [];
  const values: unknown[] = [];

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
  if (input.godmode !== undefined) {
    updates.push('godmode = ?');
    values.push(input.godmode ? 1 : 0);
  }

  if (updates.length === 0) {
    return getRequirementById(db, id);
  }

  values.push(id);
  run(db, `UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, values);
  return getRequirementById(db, id);
}

export function deleteRequirement(db: Database, id: string): void {
  run(db, 'DELETE FROM requirements WHERE id = ?', [id]);
}
