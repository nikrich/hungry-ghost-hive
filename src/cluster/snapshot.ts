// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Database } from 'sql.js';
import { queryAll, run } from '../db/client.js';
import { REPLICATED_TABLES } from './adapters.js';
import { ensureClusterTables, getAllClusterEvents, getVersionVector } from './events.js';
import { applyRemoteEvents } from './sync.js';
import type { ClusterEvent, VersionVector } from './types.js';

export interface SnapshotMetadata {
  snapshot_id: string;
  node_id: string;
  term: number;
  last_log_index: number;
  version_vector: VersionVector;
  event_count: number;
  table_row_counts: Record<string, number>;
  created_at: string;
}

export interface Snapshot {
  metadata: SnapshotMetadata;
  events: ClusterEvent[];
}

const MAX_SNAPSHOTS_RETAINED = 3;

export function createSnapshot(
  db: Database,
  nodeId: string,
  term: number,
  lastLogIndex: number
): Snapshot {
  const versionVector = getVersionVector(db);
  const events = getAllClusterEvents(db);

  const tableRowCounts: Record<string, number> = {};
  for (const adapter of REPLICATED_TABLES) {
    const rows = queryAll<Record<string, unknown>>(db, adapter.selectSql);
    tableRowCounts[adapter.table] = rows.length;
  }

  const metadata: SnapshotMetadata = {
    snapshot_id: `snap-${nodeId}-${Date.now()}`,
    node_id: nodeId,
    term,
    last_log_index: lastLogIndex,
    version_vector: versionVector,
    event_count: events.length,
    table_row_counts: tableRowCounts,
    created_at: new Date().toISOString(),
  };

  return { metadata, events };
}

export function saveSnapshot(snapshotDir: string, snapshot: Snapshot): string {
  mkdirSync(snapshotDir, { recursive: true });

  const filename = `${snapshot.metadata.snapshot_id}.json`;
  const filepath = join(snapshotDir, filename);
  const tempPath = `${filepath}.tmp`;

  writeFileSync(tempPath, JSON.stringify(snapshot), 'utf-8');
  renameSync(tempPath, filepath);

  pruneOldSnapshots(snapshotDir);

  return filepath;
}

export function loadLatestSnapshot(snapshotDir: string): Snapshot | null {
  if (!existsSync(snapshotDir)) return null;

  const files = readdirSync(snapshotDir)
    .filter(f => f.startsWith('snap-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    const content = readFileSync(join(snapshotDir, files[0]), 'utf-8');
    return JSON.parse(content) as Snapshot;
  } catch {
    return null;
  }
}

export function installSnapshot(db: Database, nodeId: string, snapshot: Snapshot): number {
  ensureClusterTables(db, nodeId);
  return applyRemoteEvents(db, nodeId, snapshot.events);
}

export function truncateClusterEvents(db: Database, versionVector: VersionVector): number {
  const events = getAllClusterEvents(db);
  let truncated = 0;

  for (const event of events) {
    const knownCounter = versionVector[event.version.actor_id] || 0;
    if (event.version.actor_counter <= knownCounter) {
      run(db, 'DELETE FROM cluster_events WHERE event_id = ?', [event.event_id]);
      truncated += 1;
    }
  }

  return truncated;
}

function pruneOldSnapshots(snapshotDir: string): void {
  const files = readdirSync(snapshotDir)
    .filter(f => f.startsWith('snap-') && f.endsWith('.json'))
    .sort()
    .reverse();

  for (let i = MAX_SNAPSHOTS_RETAINED; i < files.length; i++) {
    try {
      unlinkSync(join(snapshotDir, files[i]));
    } catch {
      // Ignore cleanup errors
    }
  }
}
