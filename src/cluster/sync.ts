// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/client.js';
import { ADAPTERS_BY_TABLE, REPLICATED_TABLES } from './adapters.js';
import { emitLocalEvent, ensureClusterTables, fetchTableSnapshots } from './events.js';
import type { ClusterEvent, RowVersionRow } from './types.js';
import { compareVersion, hashPayload, setRowHash, stableStringify } from './utils.js';

export function scanLocalChanges(db: Database, nodeId: string): number {
  ensureClusterTables(db, nodeId);

  let emitted = 0;

  for (const adapter of REPLICATED_TABLES) {
    const knownRows = queryAll<{ row_id: string; row_hash: string }>(
      db,
      'SELECT row_id, row_hash FROM cluster_row_hashes WHERE table_name = ?',
      [adapter.table]
    );

    const knownMap = new Map<string, string>(knownRows.map(row => [row.row_id, row.row_hash]));
    const seenIds = new Set<string>();

    const currentRows = fetchTableSnapshots(db, adapter);

    for (const row of currentRows) {
      seenIds.add(row.rowId);
      const previousHash = knownMap.get(row.rowId);

      if (previousHash !== row.rowHash) {
        emitLocalEvent(db, nodeId, {
          table_name: adapter.table,
          row_id: row.rowId,
          op: 'upsert',
          payload: row.payload,
        });
        emitted += 1;
      }

      run(
        db,
        `
        INSERT INTO cluster_row_hashes (table_name, row_id, row_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(table_name, row_id) DO UPDATE SET row_hash = excluded.row_hash
      `,
        [adapter.table, row.rowId, row.rowHash]
      );
    }

    for (const previous of knownRows) {
      if (seenIds.has(previous.row_id)) continue;

      emitLocalEvent(db, nodeId, {
        table_name: adapter.table,
        row_id: previous.row_id,
        op: 'delete',
        payload: null,
      });
      emitted += 1;

      run(db, 'DELETE FROM cluster_row_hashes WHERE table_name = ? AND row_id = ?', [
        adapter.table,
        previous.row_id,
      ]);
    }
  }

  return emitted;
}

export function applyRemoteEvents(db: Database, nodeId: string, events: ClusterEvent[]): number {
  ensureClusterTables(db, nodeId);

  let applied = 0;
  const sorted = [...events].sort((a, b) => compareVersion(a.version, b.version));

  for (const event of sorted) {
    const existing = queryOne<{ event_id: string }>(
      db,
      'SELECT event_id FROM cluster_events WHERE event_id = ?',
      [event.event_id]
    );

    if (existing) continue;

    const adapter = ADAPTERS_BY_TABLE.get(event.table_name);
    if (!adapter) continue;

    const shouldApply = shouldApplyEvent(db, event);

    if (shouldApply) {
      if (event.op === 'upsert' && event.payload) {
        adapter.upsert(db, event.payload);
        setRowHash(db, event.table_name, event.row_id, hashPayload(event.payload));
      } else if (event.op === 'delete') {
        adapter.delete(db, event.row_id);
        run(db, 'DELETE FROM cluster_row_hashes WHERE table_name = ? AND row_id = ?', [
          event.table_name,
          event.row_id,
        ]);
      }

      run(
        db,
        `
        INSERT INTO cluster_row_versions (table_name, row_id, actor_id, actor_counter, logical_ts)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(table_name, row_id) DO UPDATE SET
          actor_id = excluded.actor_id,
          actor_counter = excluded.actor_counter,
          logical_ts = excluded.logical_ts
      `,
        [
          event.table_name,
          event.row_id,
          event.version.actor_id,
          event.version.actor_counter,
          event.version.logical_ts,
        ]
      );

      applied += 1;
    }

    run(
      db,
      `
      INSERT OR IGNORE INTO cluster_events (event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        event.event_id,
        event.version.actor_id,
        event.version.actor_counter,
        event.version.logical_ts,
        event.table_name,
        event.row_id,
        event.op,
        event.payload ? stableStringify(event.payload) : null,
        event.created_at,
      ]
    );
  }

  return applied;
}

function shouldApplyEvent(db: Database, event: ClusterEvent): boolean {
  const existing = queryOne<RowVersionRow>(
    db,
    `
    SELECT table_name, row_id, actor_id, actor_counter, logical_ts
    FROM cluster_row_versions
    WHERE table_name = ? AND row_id = ?
  `,
    [event.table_name, event.row_id]
  );

  if (!existing) return true;

  return (
    compareVersion(event.version, {
      actor_id: existing.actor_id,
      actor_counter: Number(existing.actor_counter),
      logical_ts: Number(existing.logical_ts),
    }) > 0
  );
}
