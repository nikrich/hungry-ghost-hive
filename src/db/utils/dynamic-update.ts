// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Field definition for mapping an input property to a database column.
 * Use a plain string for direct column mapping, or an object for transforms.
 */
export type FieldDef = { column: string; transform: (value: unknown) => unknown };

export type FieldMap = Record<string, string | FieldDef>;

export interface DynamicUpdateResult {
  updates: string[];
  values: unknown[];
}

/**
 * Dual-write pair for migrating from legacy to new column names.
 * Both columns receive the same resolved value.
 */
export interface DualWritePair {
  /** Input key for the new field (e.g., 'externalIssueKey') */
  current: string;
  /** Input key for the legacy field (e.g., 'jiraIssueKey') */
  legacy: string;
  /** New DB column name (e.g., 'external_issue_key') */
  currentColumn: string;
  /** Legacy DB column name (e.g., 'jira_issue_key') */
  legacyColumn: string;
}

/**
 * Builds dynamic SET clause components from an input object and field mapping.
 *
 * For each key in fieldMap, if the corresponding input value is not undefined,
 * adds a `column = ?` entry to updates and the (optionally transformed) value to values.
 */
export function buildDynamicUpdate(
  input: Record<string, unknown>,
  fieldMap: FieldMap,
  options?: { includeUpdatedAt?: boolean }
): DynamicUpdateResult {
  const updates: string[] = [];
  const values: unknown[] = [];

  if (options?.includeUpdatedAt) {
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
  }

  for (const [inputKey, mapping] of Object.entries(fieldMap)) {
    const value = input[inputKey];
    if (value !== undefined) {
      const column = typeof mapping === 'string' ? mapping : mapping.column;
      const transformed = typeof mapping === 'string' ? value : mapping.transform(value);
      updates.push(`${column} = ?`);
      values.push(transformed);
    }
  }

  return { updates, values };
}

/**
 * Adds dual-write entries for legacy/new column pairs.
 *
 * For each pair, resolves the value (preferring `current` over `legacy` input key),
 * then writes to both columns if a value is present.
 */
export function addDualWrite(
  result: DynamicUpdateResult,
  input: Record<string, unknown>,
  pairs: DualWritePair[]
): void {
  for (const { current, legacy, currentColumn, legacyColumn } of pairs) {
    const value = input[current] !== undefined ? input[current] : input[legacy];
    if (value !== undefined) {
      result.updates.push(`${legacyColumn} = ?`);
      result.values.push(value);
      result.updates.push(`${currentColumn} = ?`);
      result.values.push(value);
    }
  }
}
