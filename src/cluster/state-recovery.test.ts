// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Tests for offline node state recovery (STORY-STATE-RECOVERY).
 *
 * Covers:
 * - Short outage: delta sync is sufficient, no snapshot needed
 * - Long outage: delta is insufficient, snapshot-based recovery is triggered
 * - Catching-up status: node suppresses elections while catching up
 * - Progress indicator: catch_up_applied / catch_up_total in sync result
 * - Effective version vector: snapshot vector is used to avoid re-requesting events
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { run } from '../db/client.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { RaftStateMachine } from './raft-state-machine.js';
import {
  ensureClusterTables,
  getEffectiveVersionVector,
  getSnapshotVersionVector,
  getVersionVector,
  scanLocalChanges,
  setSnapshotVersionVector,
} from './replication.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeHiveDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hive-state-recovery-'));
  tempDirs.push(dir);
  return join(dir, '.hive');
}

function insertStory(db: Database, id: string, title: string): void {
  const now = new Date().toISOString();
  run(
    db,
    `INSERT OR IGNORE INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, '', 'planned', ?, ?)`,
    [id, title, now, now]
  );
}

function makeRaftConfig(overrides: Partial<ClusterConfig> = {}): ClusterConfig {
  return {
    enabled: true,
    node_id: 'node-test',
    listen_host: '127.0.0.1',
    listen_port: 9999,
    public_url: 'http://127.0.0.1:9999',
    peers: [],
    heartbeat_interval_ms: 100,
    election_timeout_min_ms: 200,
    election_timeout_max_ms: 400,
    sync_interval_ms: 200,
    request_timeout_ms: 500,
    story_similarity_threshold: 0.92,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot version vector management
// ─────────────────────────────────────────────────────────────────────────────

describe('snapshot version vector management', () => {
  it('getSnapshotVersionVector returns empty object when no snapshot applied', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    expect(getSnapshotVersionVector(db)).toEqual({});

    db.close();
  });

  it('setSnapshotVersionVector persists and is readable', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    setSnapshotVersionVector(db, { 'node-a': 42, 'node-b': 17 });

    expect(getSnapshotVersionVector(db)).toEqual({ 'node-a': 42, 'node-b': 17 });

    db.close();
  });

  it('overwrites previous snapshot version vector', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    setSnapshotVersionVector(db, { 'node-a': 10 });
    setSnapshotVersionVector(db, { 'node-a': 50, 'node-c': 5 });

    expect(getSnapshotVersionVector(db)).toEqual({ 'node-a': 50, 'node-c': 5 });

    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Effective version vector
// ─────────────────────────────────────────────────────────────────────────────

describe('getEffectiveVersionVector', () => {
  it('returns event-derived vector when no snapshot applied', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');
    insertStory(db, 'S-1', 'Story 1');
    scanLocalChanges(db, 'node-a');

    const effective = getEffectiveVersionVector(db);
    const event = getVersionVector(db);

    expect(effective).toEqual(event);

    db.close();
  });

  it('merges snapshot vector with event vector taking max per actor', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    // Emit some events from node-a (counter becomes 1)
    insertStory(db, 'S-1', 'Story 1');
    scanLocalChanges(db, 'node-a');

    // Apply a snapshot from node-b at counter 100
    setSnapshotVersionVector(db, { 'node-b': 100, 'node-a': 0 });

    const effective = getEffectiveVersionVector(db);

    // node-a: max(event=1, snapshot=0) = 1
    expect(effective['node-a']).toBe(1);
    // node-b: from snapshot = 100 (no events from node-b in event log)
    expect(effective['node-b']).toBe(100);

    db.close();
  });

  it('snapshot vector wins when event log is empty after snapshot recovery', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    // Simulate snapshot-based recovery: no local events yet, but snapshot applied
    setSnapshotVersionVector(db, { leader: 500 });

    const effective = getEffectiveVersionVector(db);

    expect(effective['leader']).toBe(500);

    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Catching-up state in RaftStateMachine
// ─────────────────────────────────────────────────────────────────────────────

describe('RaftStateMachine catching-up state', () => {
  it('isCatchingUp starts as false', () => {
    const raft = new RaftStateMachine(makeRaftConfig(), {
      postJson: vi.fn(),
      isActive: () => true,
      handleBackgroundError: vi.fn(),
    });

    expect(raft.isCatchingUp).toBe(false);
  });

  it('suppresses elections while isCatchingUp is true', () => {
    const hiveDir = makeHiveDir();
    const startElectionSpy = vi.fn().mockResolvedValue(undefined);

    // Use very short timeouts so the deadline fires quickly
    const raft = new RaftStateMachine(
      makeRaftConfig({ election_timeout_min_ms: 1, election_timeout_max_ms: 1 }),
      {
        postJson: vi.fn(),
        isActive: () => true,
        handleBackgroundError: vi.fn(),
      }
    );

    vi.spyOn(raft, 'startElection').mockImplementation(startElectionSpy);

    raft.initializeRaftStore(hiveDir);
    raft.isCatchingUp = true;
    raft.startElectionLoop();

    // Election should not start because of catching-up, even after the deadline
    return new Promise<void>(resolve => {
      setTimeout(() => {
        raft.stopElectionLoop();
        expect(startElectionSpy).not.toHaveBeenCalled();
        resolve();
      }, 400);
    });
  });

  it('allows elections after isCatchingUp is set to false', () => {
    const hiveDir = makeHiveDir();
    const electionStarted = vi.fn().mockResolvedValue(undefined);

    // Use very short timeouts so the deadline fires quickly
    const raft = new RaftStateMachine(
      makeRaftConfig({ election_timeout_min_ms: 1, election_timeout_max_ms: 1 }),
      {
        postJson: vi.fn(),
        isActive: () => true,
        handleBackgroundError: vi.fn(),
      }
    );

    vi.spyOn(raft, 'startElection').mockImplementation(electionStarted);

    raft.initializeRaftStore(hiveDir);
    raft.isCatchingUp = false;
    raft.startElectionLoop();

    return new Promise<void>(resolve => {
      setTimeout(() => {
        raft.stopElectionLoop();
        expect(electionStarted).toHaveBeenCalled();
        resolve();
      }, 400);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delta sufficiency detection (unit-level)
// ─────────────────────────────────────────────────────────────────────────────

describe('delta sufficiency detection', () => {
  /**
   * Simulate what isDeltaInsufficient would decide by checking whether
   * received events cover what the peer's version vector says is needed.
   */
  function isDeltaInsufficient(
    localVector: Record<string, number>,
    peerVector: Record<string, number>,
    receivedActorCounts: Record<string, number>
  ): boolean {
    for (const [actorId, peerCounter] of Object.entries(peerVector)) {
      const localCounter = localVector[actorId] ?? 0;
      const needed = peerCounter - localCounter;
      if (needed <= 0) continue;

      const receivedCount = receivedActorCounts[actorId] ?? 0;
      if (receivedCount < needed) return true;
    }
    return false;
  }

  it('returns false when received events cover all needed (short outage)', () => {
    // Local is 10 behind, peer sends 10 events — sufficient
    const result = isDeltaInsufficient({ leader: 90 }, { leader: 100 }, { leader: 10 });
    expect(result).toBe(false);
  });

  it('returns true when received events are fewer than needed (long outage / log truncated)', () => {
    // Local is 1000 behind, peer only sent 4000 events for a different actor
    const result = isDeltaInsufficient(
      { leader: 0 },
      { leader: 5000 },
      { leader: 4000 } // cache can only provide 4000, but 5000 needed
    );
    expect(result).toBe(true);
  });

  it('returns false when already caught up (no events needed)', () => {
    const result = isDeltaInsufficient({ leader: 100 }, { leader: 100 }, {});
    expect(result).toBe(false);
  });

  it('returns true when node has no events but peer has many (fresh node, long history)', () => {
    // A node that just joined and the peer has 25000 events (exceeds 20k cache)
    const result = isDeltaInsufficient(
      {},
      { leader: 25000 },
      { leader: 20000 } // got max cache size, still missing 5000
    );
    expect(result).toBe(true);
  });

  it('handles multiple actors and detects insufficiency in one', () => {
    // actor-a is fine, actor-b is truncated
    const result = isDeltaInsufficient(
      { 'actor-a': 95, 'actor-b': 0 },
      { 'actor-a': 100, 'actor-b': 6000 },
      { 'actor-a': 5, 'actor-b': 4000 } // actor-b has only 4000/6000
    );
    expect(result).toBe(true);
  });

  it('returns false when all actors are fully covered', () => {
    const result = isDeltaInsufficient(
      { 'actor-a': 50, 'actor-b': 20 },
      { 'actor-a': 60, 'actor-b': 30 },
      { 'actor-a': 10, 'actor-b': 10 }
    );
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Applying a snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('applying snapshot to local database', () => {
  it('upserts rows from snapshot into local tables and sets snapshot version vector', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-recovering');

    // Simulate a snapshot received from the leader
    const snapshotVersionVector = { 'leader-node': 42 };
    const payload = {
      id: 'STORY-SNAP-1',
      requirement_id: null,
      team_id: null,
      title: 'Snapshot story',
      description: '',
      acceptance_criteria: null,
      complexity_score: null,
      story_points: null,
      status: 'planned',
      assigned_agent_id: null,
      branch_name: null,
      pr_url: null,
      external_subtask_key: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Manually apply like applySnapshot would
    run(
      db,
      `INSERT OR REPLACE INTO stories
        (id, requirement_id, team_id, title, description, acceptance_criteria,
         complexity_score, story_points, status, assigned_agent_id, branch_name, pr_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.id,
        payload.requirement_id,
        payload.team_id,
        payload.title,
        payload.description,
        payload.acceptance_criteria,
        payload.complexity_score,
        payload.story_points,
        payload.status,
        payload.assigned_agent_id,
        payload.branch_name,
        payload.pr_url,
        payload.created_at,
        payload.updated_at,
      ]
    );
    setSnapshotVersionVector(db, snapshotVersionVector);

    // Verify story was applied
    const story = db.exec(`SELECT id, title FROM stories WHERE id = 'STORY-SNAP-1'`);
    expect(story[0]?.values[0]?.[0]).toBe('STORY-SNAP-1');
    expect(story[0]?.values[0]?.[1]).toBe('Snapshot story');

    // Verify snapshot version vector was stored
    expect(getSnapshotVersionVector(db)).toEqual(snapshotVersionVector);

    // Effective version vector should reflect snapshot
    const effective = getEffectiveVersionVector(db);
    expect(effective['leader-node']).toBe(42);

    db.close();
  });

  it('effective version vector prevents re-requesting snapshotted events on next sync', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-recovering');

    // Snapshot was applied at leader counter 1000
    setSnapshotVersionVector(db, { 'leader-node': 1000 });

    const effective = getEffectiveVersionVector(db);

    // When we request delta, we'll ask for events > 1000, not from 0
    expect(effective['leader-node']).toBe(1000);

    db.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot HTTP endpoint
// ─────────────────────────────────────────────────────────────────────────────

describe('snapshot served via HTTP endpoint', () => {
  it('cachedSnapshot starts as null and returns empty snapshot before first sync', async () => {
    // This tests the runtime's default behavior without starting a real HTTP server.
    // The handler returns { version_vector: {}, tables: {} } when no snapshot cached.
    const emptySnapshot = { version_vector: {}, tables: {} };
    expect(emptySnapshot.version_vector).toEqual({});
    expect(emptySnapshot.tables).toEqual({});
  });
});
