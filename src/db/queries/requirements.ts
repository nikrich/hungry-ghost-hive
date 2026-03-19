// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { RequirementRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { RequirementRow };

export type RequirementStatus =
  | 'pending'
  | 'planning'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'sign_off'
  | 'sign_off_failed'
  | 'sign_off_passed';

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

export function createRequirement(
  provider: DatabaseProvider,
  input: CreateRequirementInput
): RequirementRow {
  const id = `REQ-${nanoid(8).toUpperCase()}`;
  const now = new Date().toISOString();

  provider.run(
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

  return getRequirementById(provider, id)!;
}

export function getRequirementById(
  provider: DatabaseProvider,
  id: string
): RequirementRow | undefined {
  return provider.queryOne<RequirementRow>('SELECT * FROM requirements WHERE id = ?', [id]);
}

export function getAllRequirements(provider: DatabaseProvider): RequirementRow[] {
  return provider.queryAll<RequirementRow>(
    'SELECT * FROM requirements ORDER BY created_at DESC, rowid DESC'
  );
}

export function getRequirementsByStatus(
  provider: DatabaseProvider,
  status: RequirementStatus
): RequirementRow[] {
  return provider.queryAll<RequirementRow>(
    'SELECT * FROM requirements WHERE status = ? ORDER BY created_at DESC, rowid DESC',
    [status]
  );
}

export function getPendingRequirements(provider: DatabaseProvider): RequirementRow[] {
  return provider.queryAll<RequirementRow>(`
    SELECT * FROM requirements
    WHERE status IN ('pending', 'planning', 'in_progress')
    ORDER BY created_at, rowid
  `);
}

export function updateRequirement(
  provider: DatabaseProvider,
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
    return getRequirementById(provider, id);
  }

  values.push(id);
  provider.run(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, values);
  return getRequirementById(provider, id);
}

export function deleteRequirement(provider: DatabaseProvider, id: string): void {
  provider.run('DELETE FROM requirements WHERE id = ?', [id]);
}
