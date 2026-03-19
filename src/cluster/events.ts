// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../db/provider.js';
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

export function ensureClusterTables(db: DatabaseProvider, nodeId: string): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS cluster_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      node_id TEXT NOT NULL,
      event_counter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
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
  `);

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cluster_events_actor_counter
    ON cluster_events(actor_id, actor_counter)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_cluster_events_logical_ts
    ON cluster_events(logical_ts)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cluster_row_versions (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_counter INTEGER NOT NULL,
      logical_ts INTEGER NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cluster_row_hashes (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cluster_story_merges (
      duplicate_story_id TEXT PRIMARY KEY,
      canonical_story_id TEXT NOT NULL,
      merged_at TEXT NOT NULL
    )
  `);

  // Add snapshot_version_vector column if it doesn't exist yet (backward-compat migration)
  try {
    db.run('ALTER TABLE cluster_state ADD COLUMN snapshot_version_vector TEXT');
  } catch {
    // Column already exists — ignore
  }

  const state = db.queryOne<{ id: number }>('SELECT id FROM cluster_state WHERE id = 1');
  const now = new Date().toISOString();

  if (!state) {
    db.run(
      'INSERT INTO cluster_state (id, node_id, event_counter, updated_at) VALUES (1, ?, 0, ?)',
      [nodeId, now]
    );
  } else {
    db.run('UPDATE cluster_state SET node_id = ?, updated_at = ? WHERE id = 1', [nodeId, now]);
  }
}

export function getVersionVector(db: DatabaseProvider): VersionVector {
  const rows = db.queryAll<{ actor_id: string; max_counter: number }>(`
    SELECT actor_id, MAX(actor_counter) as max_counter
    FROM cluster_events
    GROUP BY actor_id
  `);

  const vector: VersionVector = {};
  for (const row of rows) {
    vector[row.actor_id] = Number(row.max_counter) || 0;
  }

  return vector;
}

/**
 * Returns the snapshot version vector stored after the last snapshot-based recovery.
 * Empty object if no snapshot has been applied.
 */
export function getSnapshotVersionVector(db: DatabaseProvider): VersionVector {
  const row = db.queryOne<{ snapshot_version_vector: string | null }>(
    'SELECT snapshot_version_vector FROM cluster_state WHERE id = 1'
  );

  if (!row?.snapshot_version_vector) return {};

  try {
    return JSON.parse(row.snapshot_version_vector) as VersionVector;
  } catch {
    return {};
  }
}

/**
 * Persists the snapshot version vector so that future delta requests start
 * from this point rather than from the (empty) event log.
 */
export function setSnapshotVersionVector(db: DatabaseProvider, vector: VersionVector): void {
  db.run('UPDATE cluster_state SET snapshot_version_vector = ? WHERE id = 1', [
    JSON.stringify(vector),
  ]);
}

/**
 * Returns the effective version vector for delta-sync requests.
 * Takes the max per actor between the event-log-derived vector and any
 * snapshot vector stored from a previous snapshot-based recovery.
 * This prevents re-requesting events that were already covered by a snapshot.
 */
export function getEffectiveVersionVector(db: DatabaseProvider): VersionVector {
  const eventVector = getVersionVector(db);
  const snapshotVector = getSnapshotVersionVector(db);

  const effective: VersionVector = { ...snapshotVector };
  for (const [actor, counter] of Object.entries(eventVector)) {
    effective[actor] = Math.max(effective[actor] ?? 0, counter);
  }

  return effective;
}

export function getAllClusterEvents(db: DatabaseProvider): ClusterEvent[] {
  const rows = db.queryAll<ClusterEventRow>(`
    SELECT event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at
    FROM cluster_events
    ORDER BY logical_ts ASC, actor_id ASC, actor_counter ASC
  `);

  return rows.map(mapEventRow);
}

export function getDeltaEvents(
  db: DatabaseProvider,
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
  db: DatabaseProvider,
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

  db.run(
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

  db.run(
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

/**
 * Prune old cluster_events rows, retaining only the most recent `retainCount` events.
 * Returns the number of rows deleted.
 */
export function pruneClusterEvents(db: DatabaseProvider, retainCount: number): number {
  if (retainCount <= 0) return 0;

  const countRow = db.queryOne<{ total: number }>('SELECT COUNT(*) as total FROM cluster_events');
  const total = countRow?.total || 0;

  if (total <= retainCount) return 0;

  // Delete events that are not in the most recent `retainCount` by logical_ts ordering.
  // We keep the newest events and delete the oldest.
  db.run(
    `
    DELETE FROM cluster_events
    WHERE event_id NOT IN (
      SELECT event_id FROM cluster_events
      ORDER BY logical_ts DESC, actor_id DESC, actor_counter DESC
      LIMIT ?
    )
  `,
    [retainCount]
  );

  const afterRow = db.queryOne<{ total: number }>('SELECT COUNT(*) as total FROM cluster_events');
  return total - (afterRow?.total || 0);
}

export function getClusterEventCount(db: DatabaseProvider): number {
  const row = db.queryOne<{ total: number }>('SELECT COUNT(*) as total FROM cluster_events');
  return row?.total || 0;
}

export function fetchTableSnapshots(
  db: DatabaseProvider,
  adapter: TableAdapter
): TableRowSnapshot[] {
  const rows = db.queryAll<Record<string, unknown>>(adapter.selectSql);

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
