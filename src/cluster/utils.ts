// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createHash } from 'crypto';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/client.js';
import type { ClusterEventVersion, ReplicatedTable } from './types.js';

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortKeys(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortKeys(obj[key]);
    }
    return result;
  }

  return value;
}

export function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

export function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asString(value);
}

export function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = asNumber(value);
  return Number.isFinite(num) ? num : null;
}

export function compareVersion(a: ClusterEventVersion, b: ClusterEventVersion): number {
  if (a.logical_ts !== b.logical_ts) {
    return a.logical_ts - b.logical_ts;
  }

  if (a.actor_id !== b.actor_id) {
    return a.actor_id.localeCompare(b.actor_id);
  }

  return a.actor_counter - b.actor_counter;
}

export function splitDependencyRowId(rowId: string): [string, string] {
  const idx = rowId.indexOf('::');
  if (idx === -1) return [rowId, ''];
  return [rowId.slice(0, idx), rowId.slice(idx + 2)];
}

export function toAgentLogPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    agent_id: asString(row.agent_id),
    story_id: asNullableString(row.story_id),
    event_type: asString(row.event_type),
    status: asNullableString(row.status),
    message: asNullableString(row.message),
    metadata: asNullableString(row.metadata),
    timestamp: asString(row.timestamp),
  };
}

export function deleteAgentLogByRowId(db: Database, rowId: string): void {
  const rows = queryAll<Record<string, unknown>>(
    db,
    'SELECT id, agent_id, story_id, event_type, status, message, metadata, timestamp FROM agent_logs'
  );

  for (const row of rows) {
    const payload = toAgentLogPayload(row);
    if (hashPayload(payload) !== rowId) continue;
    run(db, 'DELETE FROM agent_logs WHERE id = ?', [asNumber(row.id)]);
    break;
  }
}

export function setRowHash(
  db: Database,
  table: ReplicatedTable,
  rowId: string,
  rowHash: string
): void {
  run(
    db,
    `
    INSERT INTO cluster_row_hashes (table_name, row_id, row_hash)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, row_id) DO UPDATE SET row_hash = excluded.row_hash
  `,
    [table, rowId, rowHash]
  );
}

export function incrementAndGetCounter(db: Database): number {
  run(
    db,
    'UPDATE cluster_state SET event_counter = event_counter + 1, updated_at = ? WHERE id = 1',
    [new Date().toISOString()]
  );

  const state = queryOne<{ event_counter: number }>(
    db,
    'SELECT event_counter FROM cluster_state WHERE id = 1'
  );

  return Number(state?.event_counter || 0);
}
