// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { queryOne, run } from '../db/client.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { ensureClusterTables, getAllClusterEvents, getVersionVector } from './events.js';
import { scanLocalChanges } from './sync.js';
import {
  createSnapshot,
  installSnapshot,
  loadLatestSnapshot,
  saveSnapshot,
  truncateClusterEvents,
} from './snapshot.js';
import { RaftMetadataStore } from './raft-store.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0;
});

describe('snapshot', () => {
  it('creates a snapshot from current database state', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    run(
      db,
      `INSERT INTO teams (id, repo_url, repo_path, name, created_at)
       VALUES ('team-1', 'https://example.com/a.git', 'repos/a', 'alpha', ?)`,
      [new Date().toISOString()]
    );

    scanLocalChanges(db, 'node-a');

    const snapshot = createSnapshot(db, 'node-a', 3, 42);

    expect(snapshot.metadata.node_id).toBe('node-a');
    expect(snapshot.metadata.term).toBe(3);
    expect(snapshot.metadata.last_log_index).toBe(42);
    expect(snapshot.metadata.event_count).toBeGreaterThan(0);
    expect(snapshot.metadata.table_row_counts.teams).toBe(1);
    expect(snapshot.metadata.version_vector['node-a']).toBeGreaterThan(0);
    expect(snapshot.events.length).toBe(snapshot.metadata.event_count);
    expect(snapshot.metadata.snapshot_id).toMatch(/^snap-node-a-/);

    db.close();
  });

  it('saves and loads snapshots from disk', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    run(
      db,
      `INSERT INTO teams (id, repo_url, repo_path, name, created_at)
       VALUES ('team-1', 'https://example.com/a.git', 'repos/a', 'alpha', ?)`,
      [new Date().toISOString()]
    );

    scanLocalChanges(db, 'node-a');

    const snapshot = createSnapshot(db, 'node-a', 1, 10);
    const snapshotDir = makeTempDir();
    saveSnapshot(snapshotDir, snapshot);

    const loaded = loadLatestSnapshot(snapshotDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.snapshot_id).toBe(snapshot.metadata.snapshot_id);
    expect(loaded!.events.length).toBe(snapshot.events.length);

    db.close();
  });

  it('returns null when no snapshots exist', () => {
    const snapshotDir = makeTempDir();
    const loaded = loadLatestSnapshot(snapshotDir);
    expect(loaded).toBeNull();
  });

  it('returns null for non-existent directory', () => {
    const loaded = loadLatestSnapshot('/tmp/nonexistent-snapshot-dir-12345');
    expect(loaded).toBeNull();
  });

  it('installs a snapshot into a fresh database', async () => {
    const sourceDb = await createTestDatabase();
    ensureClusterTables(sourceDb, 'node-a');

    run(
      sourceDb,
      `INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
       VALUES ('STORY-SNAP1', NULL, NULL, 'Snapshot story', 'Test snapshot install', 'planned', ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()]
    );

    scanLocalChanges(sourceDb, 'node-a');
    const snapshot = createSnapshot(sourceDb, 'node-a', 2, 20);

    const targetDb = await createTestDatabase();
    const applied = installSnapshot(targetDb, 'node-b', snapshot);
    expect(applied).toBeGreaterThan(0);

    const story = queryOne<{ id: string; title: string }>(
      targetDb,
      `SELECT id, title FROM stories WHERE id = 'STORY-SNAP1'`
    );
    expect(story?.id).toBe('STORY-SNAP1');
    expect(story?.title).toBe('Snapshot story');

    sourceDb.close();
    targetDb.close();
  });

  it('truncates cluster_events older than snapshot version vector', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    run(
      db,
      `INSERT INTO teams (id, repo_url, repo_path, name, created_at)
       VALUES ('team-1', 'https://example.com/a.git', 'repos/a', 'alpha', ?)`,
      [new Date().toISOString()]
    );

    scanLocalChanges(db, 'node-a');

    run(db, `UPDATE teams SET name = 'alpha-v2' WHERE id = 'team-1'`);
    scanLocalChanges(db, 'node-a');

    const eventsBefore = getAllClusterEvents(db);
    expect(eventsBefore.length).toBeGreaterThanOrEqual(2);

    const vv = getVersionVector(db);
    const truncated = truncateClusterEvents(db, vv);
    expect(truncated).toBe(eventsBefore.length);

    const eventsAfter = getAllClusterEvents(db);
    expect(eventsAfter.length).toBe(0);

    db.close();
  });

  it('prunes old snapshots keeping only the most recent ones', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    run(
      db,
      `INSERT INTO teams (id, repo_url, repo_path, name, created_at)
       VALUES ('team-1', 'https://example.com/a.git', 'repos/a', 'alpha', ?)`,
      [new Date().toISOString()]
    );

    scanLocalChanges(db, 'node-a');

    const snapshotDir = makeTempDir();

    // Create 5 snapshots
    for (let i = 0; i < 5; i++) {
      const snapshot = createSnapshot(db, 'node-a', 1, i + 1);
      saveSnapshot(snapshotDir, snapshot);
      // Small delay to ensure unique timestamps in snapshot IDs
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    const files = readdirSync(snapshotDir).filter(f => f.endsWith('.json'));
    // MAX_SNAPSHOTS_RETAINED = 3
    expect(files.length).toBe(3);

    db.close();
  });

  it('truncates raft-log.ndjson keeping entries after specified index', () => {
    const clusterDir = makeTempDir();

    const store = new RaftMetadataStore({ clusterDir, nodeId: 'node-a' });

    // Append several entries
    store.appendEntry({ type: 'runtime', metadata: { event: 'start' } });
    store.appendEntry({ type: 'heartbeat_sent', metadata: { peer: 'node-b' } });
    store.appendEntry({ type: 'heartbeat_sent', metadata: { peer: 'node-c' } });
    store.appendEntry({ type: 'election_start', metadata: { term: 2 } });
    store.appendEntry({ type: 'election_won', metadata: { term: 2, votes: 2 } });

    const state = store.getState();
    expect(state.last_log_index).toBe(5);

    // Truncate entries before index 4 (keep 4 and 5)
    const truncated = store.truncateLog(4);
    expect(truncated).toBe(3);

    // Verify the store still works after truncation
    store.appendEntry({ type: 'runtime', metadata: { event: 'after_truncation' } });
    const stateAfter = store.getState();
    expect(stateAfter.last_log_index).toBe(6);
  });

  it('round-trips snapshot through save and install for full state recovery', async () => {
    const sourceDb = await createTestDatabase();
    ensureClusterTables(sourceDb, 'node-a');

    // Insert data across multiple tables
    const now = new Date().toISOString();
    run(
      sourceDb,
      `INSERT INTO teams (id, repo_url, repo_path, name, created_at)
       VALUES ('team-rt', 'https://example.com/rt.git', 'repos/rt', 'roundtrip', ?)`,
      [now]
    );

    run(
      sourceDb,
      `INSERT INTO requirements (id, title, description, submitted_by, status, created_at)
       VALUES ('REQ-RT', 'Round trip req', 'Test round trip', 'human', 'pending', ?)`,
      [now]
    );

    run(
      sourceDb,
      `INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
       VALUES ('STORY-RT', 'REQ-RT', 'team-rt', 'Round trip story', 'Full recovery test', 'planned', ?, ?)`,
      [now, now]
    );

    scanLocalChanges(sourceDb, 'node-a');

    // Create snapshot, save to disk, load from disk, install into fresh db
    const snapshot = createSnapshot(sourceDb, 'node-a', 5, 100);
    const snapshotDir = makeTempDir();
    saveSnapshot(snapshotDir, snapshot);

    const loaded = loadLatestSnapshot(snapshotDir)!;
    expect(loaded).not.toBeNull();

    const targetDb = await createTestDatabase();
    const applied = installSnapshot(targetDb, 'node-b', loaded);
    expect(applied).toBeGreaterThan(0);

    // Verify all tables recovered
    const team = queryOne<{ name: string }>(
      targetDb,
      `SELECT name FROM teams WHERE id = 'team-rt'`
    );
    expect(team?.name).toBe('roundtrip');

    const req = queryOne<{ title: string }>(
      targetDb,
      `SELECT title FROM requirements WHERE id = 'REQ-RT'`
    );
    expect(req?.title).toBe('Round trip req');

    const story = queryOne<{ title: string }>(
      targetDb,
      `SELECT title FROM stories WHERE id = 'STORY-RT'`
    );
    expect(story?.title).toBe('Round trip story');

    sourceDb.close();
    targetDb.close();
  });
});
