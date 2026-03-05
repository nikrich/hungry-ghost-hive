// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type RequirementRow } from '../client.js';
import { addDualWrite, buildDynamicUpdate, type FieldMap } from '../utils/dynamic-update.js';

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

const requirementFieldMap: FieldMap = {
  title: 'title',
  description: 'description',
  status: 'status',
  godmode: { column: 'godmode', transform: (v) => (v ? 1 : 0) },
  targetBranch: 'target_branch',
  externalProvider: 'external_provider',
  featureBranch: 'feature_branch',
};

const requirementDualWritePairs = [
  { current: 'externalEpicKey', legacy: 'jiraEpicKey', currentColumn: 'external_epic_key', legacyColumn: 'jira_epic_key' },
  { current: 'externalEpicId', legacy: 'jiraEpicId', currentColumn: 'external_epic_id', legacyColumn: 'jira_epic_id' },
];

export function updateRequirement(
  db: Database,
  id: string,
  input: UpdateRequirementInput
): RequirementRow | undefined {
  const result = buildDynamicUpdate(input, requirementFieldMap);
  addDualWrite(result, input, requirementDualWritePairs);

  if (result.updates.length === 0) {
    return getRequirementById(db, id);
  }

  result.values.push(id);
  run(db, `UPDATE requirements SET ${result.updates.join(', ')} WHERE id = ?`, result.values);
  return getRequirementById(db, id);
}

export function deleteRequirement(db: Database, id: string): void {
  run(db, 'DELETE FROM requirements WHERE id = ?', [id]);
}
