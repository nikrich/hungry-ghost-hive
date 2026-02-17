// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type Database from 'better-sqlite3';
import { queryAll, queryOne, run } from '../db/client.js';
import type {
  ClusterEvent,
  ClusterEventRow,
  ReplicatedTable,
  ReplicationOp,
  TableAdapter,
  TableRowSnapshot,
  VersionVector,
} from './types.js';
import { hashPayload, incrementAndGetCounter, stableStringify, toObject } from './utils.js';

export function ensureClusterTables(db: Database.Database, nodeId: string): void {
  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      node_id TEXT NOT NULL,
      event_counter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_events (
      event_id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_counter INTEGER NOT NULL,
      logical_ts INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK(op IN ('upsert', 'delete')),
      payload TEXT,
      created_at TEXT NOT NULL
    )
  `
  );

  run(
    db,
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cluster_events_actor_counter
    ON cluster_events(actor_id, actor_counter)
  `
  );

  run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_cluster_events_logical_ts
    ON cluster_events(logical_ts)
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_row_versions (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_counter INTEGER NOT NULL,
      logical_ts INTEGER NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_row_hashes (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_story_merges (
      duplicate_story_id TEXT PRIMARY KEY,
      canonical_story_id TEXT NOT NULL,
      merged_at TEXT NOT NULL
    )
  `
  );

  const state = queryOne<{ id: number }>(db, 'SELECT id FROM cluster_state WHERE id = 1');
  const now = new Date().toISOString();

  if (!state) {
    run(
      db,
      'INSERT INTO cluster_state (id, node_id, event_counter, updated_at) VALUES (1, ?, 0, ?)',
      [nodeId, now]
    );
  } else {
    run(db, 'UPDATE cluster_state SET node_id = ?, updated_at = ? WHERE id = 1', [nodeId, now]);
  }
}

export function getVersionVector(db: Database.Database): VersionVector {
  const rows = queryAll<{ actor_id: string; max_counter: number }>(
    db,
    `
    SELECT actor_id, MAX(actor_counter) as max_counter
    FROM cluster_events
    GROUP BY actor_id
  `
  );

  const vector: VersionVector = {};
  for (const row of rows) {
    vector[row.actor_id] = Number(row.max_counter) || 0;
  }

  return vector;
}

export function getAllClusterEvents(db: Database.Database): ClusterEvent[] {
  const rows = queryAll<ClusterEventRow>(
    db,
    `
    SELECT event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at
    FROM cluster_events
    ORDER BY logical_ts ASC, actor_id ASC, actor_counter ASC
  `
  );

  return rows.map(mapEventRow);
}

export function getDeltaEvents(
  db: Database.Database,
  remoteVersionVector: VersionVector,
  limit = 2000
): ClusterEvent[] {
  const events = getAllClusterEvents(db);
  const missing = events.filter(event => {
    const known = remoteVersionVector[event.version.actor_id] || 0;
    return event.version.actor_counter > known;
  });

  return missing.slice(0, limit);
}

export function emitLocalEvent(
  db: Database.Database,
  nodeId: string,
  input: {
    table_name: ReplicatedTable;
    row_id: string;
    op: ReplicationOp;
    payload: Record<string, unknown> | null;
  }
): void {
  const nextCounter = incrementAndGetCounter(db);
  const logicalTs = Date.now();
  const createdAt = new Date(logicalTs).toISOString();
  const eventId = `${nodeId}:${nextCounter}`;

  run(
    db,
    `
    INSERT OR REPLACE INTO cluster_events
      (event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      eventId,
      nodeId,
      nextCounter,
      logicalTs,
      input.table_name,
      input.row_id,
      input.op,
      input.payload ? stableStringify(input.payload) : null,
      createdAt,
    ]
  );

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
    [input.table_name, input.row_id, nodeId, nextCounter, logicalTs]
  );
}

export function fetchTableSnapshots(
  db: Database.Database,
  adapter: TableAdapter
): TableRowSnapshot[] {
  const rows = queryAll<Record<string, unknown>>(db, adapter.selectSql);

  return rows.map(row => {
    const payload = adapter.payload(row);
    return {
      rowId: adapter.rowId(row),
      rowHash: hashPayload(payload),
      payload,
    };
  });
}

function mapEventRow(row: ClusterEventRow): ClusterEvent {
  return {
    event_id: row.event_id,
    table_name: row.table_name,
    row_id: row.row_id,
    op: row.op,
    payload: row.payload ? toObject(JSON.parse(row.payload)) : null,
    version: {
      actor_id: row.actor_id,
      actor_counter: Number(row.actor_counter),
      logical_ts: Number(row.logical_ts),
    },
    created_at: row.created_at,
  };
}
