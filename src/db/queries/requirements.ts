// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type RequirementRow } from '../client.js';

export type { RequirementRow };

export type RequirementStatus = 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed' | 'sign_off' | 'sign_off_failed' | 'sign_off_passed';

export interface CreateRequirementInput {
  title: string;
  description: string;
  submittedBy?: string;
  godmode?: boolean;
  targetBranch?: string;
  featureBranch?: string;
}

export interface UpdateRequirementInput {
  title?: string;
  description?: string;
  status?: RequirementStatus;
  godmode?: boolean;
  targetBranch?: string;
  /** @deprecated Use externalEpicKey instead */
  jiraEpicKey?: string | null;
  /** @deprecated Use externalEpicId instead */
  jiraEpicId?: string | null;
  externalEpicKey?: string | null;
  externalEpicId?: string | null;
  externalProvider?: string | null;
  featureBranch?: string | null;
}

export function createRequirement(db: Database, input: CreateRequirementInput): RequirementRow {
  const id = `REQ-${nanoid(8).toUpperCase()}`;
  const now = new Date().toISOString();

  run(
    db,
    `
    INSERT INTO requirements (id, title, description, submitted_by, godmode, target_branch, feature_branch, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      id,
      input.title,
      input.description,
      input.submittedBy || 'human',
      input.godmode ? 1 : 0,
      input.targetBranch || 'main',
      input.featureBranch || null,
      now,
    ]
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
  if (input.targetBranch !== undefined) {
    updates.push('target_branch = ?');
    values.push(input.targetBranch);
  }
  // Dual-write: support both legacy jira_* and new external_* columns
  const epicKey = input.externalEpicKey !== undefined ? input.externalEpicKey : input.jiraEpicKey;
  const epicId = input.externalEpicId !== undefined ? input.externalEpicId : input.jiraEpicId;

  if (epicKey !== undefined) {
    updates.push('jira_epic_key = ?');
    values.push(epicKey);
    updates.push('external_epic_key = ?');
    values.push(epicKey);
  }
  if (epicId !== undefined) {
    updates.push('jira_epic_id = ?');
    values.push(epicId);
    updates.push('external_epic_id = ?');
    values.push(epicId);
  }
  if (input.externalProvider !== undefined) {
    updates.push('external_provider = ?');
    values.push(input.externalProvider);
  }
  if (input.featureBranch !== undefined) {
    updates.push('feature_branch = ?');
    values.push(input.featureBranch);
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
