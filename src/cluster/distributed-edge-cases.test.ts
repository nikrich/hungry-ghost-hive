// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer as createNetServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { queryAll, queryOne, run } from '../db/client.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { RaftMetadataStore, type DurableRaftLogEntry } from './raft-store.js';
import {
  applyRemoteEvents,
  ensureClusterTables,
  getAllClusterEvents,
  getDeltaEvents,
  getVersionVector,
  mergeSimilarStories,
  scanLocalChanges,
  type ClusterEvent,
} from './replication.js';
import { ClusterRuntime } from './runtime.js';

const tempDirs: string[] = [];
const activeRuntimes: ClusterRuntime[] = [];

afterEach(async () => {
  for (const runtime of activeRuntimes.splice(0)) {
    try {
      await runtime.stop();
    } catch {
      // Best effort runtime cleanup.
    }
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('distributed replication edge cases', () => {
  it('emits upsert event for story dependency rows using compound row id', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-A', 'A', 'A');
    insertStory(db, 'S-B', 'B', 'B');
    run(db, `INSERT INTO story_dependencies (story_id, depends_on_story_id) VALUES ('S-A', 'S-B')`);

    scanLocalChanges(db, 'node-a');

    const depEvent = queryOne<{ row_id: string; op: string }>(
      db,
      `
      SELECT row_id, op
      FROM cluster_events
      WHERE table_name = 'story_dependencies'
      LIMIT 1
    `
    );

    expect(depEvent).toEqual({ row_id: 'S-A::S-B', op: 'upsert' });
    db.close();
  });

  it('emits delete event when story dependency rows are removed', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-A', 'A', 'A');
    insertStory(db, 'S-B', 'B', 'B');
    run(db, `INSERT INTO story_dependencies (story_id, depends_on_story_id) VALUES ('S-A', 'S-B')`);
    scanLocalChanges(db, 'node-a');

    run(
      db,
      `DELETE FROM story_dependencies WHERE story_id = 'S-A' AND depends_on_story_id = 'S-B'`
    );
    const emitted = scanLocalChanges(db, 'node-a');

    const lastDepEvent = queryOne<{ row_id: string; op: string }>(
      db,
      `
      SELECT row_id, op
      FROM cluster_events
      WHERE table_name = 'story_dependencies'
      ORDER BY actor_counter DESC
      LIMIT 1
    `
    );

    expect(emitted).toBe(1);
    expect(lastDepEvent).toEqual({ row_id: 'S-A::S-B', op: 'delete' });
    db.close();
  });

  it('applies remote upsert events for story dependencies', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-A', 'A', 'A');
    insertStory(db, 'S-B', 'B', 'B');

    const event = buildEvent({
      event_id: 'node-r:1',
      table_name: 'story_dependencies',
      row_id: 'S-A::S-B',
      payload: { story_id: 'S-A', depends_on_story_id: 'S-B' },
    });

    const applied = applyRemoteEvents(db, 'node-local', [event]);
    const dep = queryOne<{ story_id: string; depends_on_story_id: string }>(
      db,
      `
      SELECT story_id, depends_on_story_id
      FROM story_dependencies
      WHERE story_id = 'S-A' AND depends_on_story_id = 'S-B'
    `
    );

    expect(applied).toBe(1);
    expect(dep).toEqual({ story_id: 'S-A', depends_on_story_id: 'S-B' });
    db.close();
  });

  it('applies remote story deletes and removes related dependencies', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-1', 'One', 'One');
    insertStory(db, 'S-2', 'Two', 'Two');
    run(db, `INSERT INTO story_dependencies (story_id, depends_on_story_id) VALUES ('S-1', 'S-2')`);

    const deleteEvent = buildEvent({
      event_id: 'node-r:2',
      table_name: 'stories',
      row_id: 'S-2',
      op: 'delete',
      payload: null,
      version: { actor_id: 'node-r', actor_counter: 2, logical_ts: 2000 },
    });

    const applied = applyRemoteEvents(db, 'node-local', [deleteEvent]);
    const story = queryOne<{ id: string }>(db, `SELECT id FROM stories WHERE id = 'S-2'`);
    const depsCount = queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM story_dependencies WHERE depends_on_story_id = 'S-2'`
    );

    expect(applied).toBe(1);
    expect(story).toBeUndefined();
    expect(depsCount?.count).toBe(0);
    db.close();
  });

  it('clears stored row hash when delete event removes a story', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-HASH', 'Hash', 'Hash');
    scanLocalChanges(db, 'node-a');

    const before = queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM cluster_row_hashes WHERE table_name = 'stories' AND row_id = 'S-HASH'`
    );

    const deleteEvent = buildEvent({
      event_id: 'node-r:5',
      table_name: 'stories',
      row_id: 'S-HASH',
      op: 'delete',
      payload: null,
      version: { actor_id: 'node-r', actor_counter: 5, logical_ts: Date.now() + 1000 },
    });

    applyRemoteEvents(db, 'node-local', [deleteEvent]);
    const after = queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM cluster_row_hashes WHERE table_name = 'stories' AND row_id = 'S-HASH'`
    );

    expect(before?.count).toBe(1);
    expect(after?.count).toBe(0);
    db.close();
  });

  it('returns all cluster events ordered by logical timestamp then actor id', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    run(
      db,
      `
      INSERT INTO cluster_events (event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at)
      VALUES
        ('e3', 'node-b', 3, 200, 'stories', 'S-3', 'upsert', NULL, ?),
        ('e1', 'node-b', 1, 100, 'stories', 'S-1', 'upsert', NULL, ?),
        ('e2', 'node-a', 2, 100, 'stories', 'S-2', 'upsert', NULL, ?)
    `,
      [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]
    );

    const order = getAllClusterEvents(db).map(event => event.event_id);
    expect(order).toEqual(['e2', 'e1', 'e3']);
    db.close();
  });

  it('returns no delta events when remote version vector is fully current', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-DELTA', 'Delta', 'Delta');
    scanLocalChanges(db, 'node-a');

    const vector = getVersionVector(db);
    const delta = getDeltaEvents(db, vector, 100);

    expect(delta).toHaveLength(0);
    db.close();
  });

  it('records upsert events with null payload without writing target rows', async () => {
    const db = await createTestDatabase();

    const event = buildEvent({
      event_id: 'node-r:7',
      table_name: 'stories',
      row_id: 'S-NULL',
      op: 'upsert',
      payload: null,
      version: { actor_id: 'node-r', actor_counter: 7, logical_ts: 7000 },
    });

    const applied = applyRemoteEvents(db, 'node-local', [event]);
    const row = queryOne<{ id: string }>(db, `SELECT id FROM stories WHERE id = 'S-NULL'`);
    const recorded = queryOne<{ event_id: string }>(
      db,
      `SELECT event_id FROM cluster_events WHERE event_id = 'node-r:7'`
    );

    expect(applied).toBe(1);
    expect(row).toBeUndefined();
    expect(recorded?.event_id).toBe('node-r:7');
    db.close();
  });

  it('keeps the highest progression status when merging duplicate stories', async () => {
    const db = await createTestDatabase();
    insertStory(
      db,
      'S-100',
      'Implement OAuth Login',
      'Implement oauth2 login with pkce flow',
      'planned'
    );
    insertStory(
      db,
      'S-200',
      'Implement OAuth Login',
      'Implement oauth2 login with pkce flow',
      'review'
    );

    const merged = mergeSimilarStories(db, 0.8);
    const canonical = queryOne<{ status: string }>(
      db,
      `SELECT status FROM stories WHERE id = 'S-100'`
    );

    expect(merged).toBe(1);
    expect(canonical?.status).toBe('review');
    db.close();
  });

  it('keeps longer title and description when merging duplicate stories', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-LONG-1', 'Implement OAuth Login', 'Implement oauth2 login with pkce');
    insertStory(
      db,
      'S-LONG-2',
      'Implement OAuth Login With PKCE Flow',
      'Implement oauth2 login with pkce flow and callback handling'
    );

    const merged = mergeSimilarStories(db, 0.5);
    const canonical = queryOne<{ title: string; description: string }>(
      db,
      `SELECT title, description FROM stories WHERE id = 'S-LONG-1'`
    );

    expect(merged).toBe(1);
    expect(canonical?.title).toBe('Implement OAuth Login With PKCE Flow');
    expect(canonical?.description).toBe(
      'Implement oauth2 login with pkce flow and callback handling'
    );
    db.close();
  });

  it('takes maximum complexity and story points when merging duplicates', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-COMP-1', 'Auth merge', 'Auth merge', 'planned', 3, 2);
    insertStory(db, 'S-COMP-2', 'Auth merge', 'Auth merge', 'planned', 8, 5);

    const merged = mergeSimilarStories(db, 0.8);
    const canonical = queryOne<{ complexity_score: number; story_points: number }>(
      db,
      `SELECT complexity_score, story_points FROM stories WHERE id = 'S-COMP-1'`
    );

    expect(merged).toBe(1);
    expect(canonical?.complexity_score).toBe(8);
    expect(canonical?.story_points).toBe(5);
    db.close();
  });

  it('ignores stories already marked merged when searching for duplicates', async () => {
    const db = await createTestDatabase();
    insertStory(db, 'S-MERGED-1', 'Auth duplicate', 'Auth duplicate', 'planned');
    insertStory(db, 'S-MERGED-2', 'Auth duplicate', 'Auth duplicate', 'merged');

    const merged = mergeSimilarStories(db, 0.8);
    const ids = queryAll<{ id: string }>(db, `SELECT id FROM stories ORDER BY id`).map(
      row => row.id
    );

    expect(merged).toBe(0);
    expect(ids).toEqual(['S-MERGED-1', 'S-MERGED-2']);
    db.close();
  });
});

describe('durable raft metadata edge cases', () => {
  it('falls back to a clean default state when raft-state.json is malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-edge-'));
    tempDirs.push(dir);

    writeFileSync(join(dir, 'raft-state.json'), '{broken-json', 'utf-8');
    const store = new RaftMetadataStore({ clusterDir: dir, nodeId: 'node-clean' });
    const state = store.getState();

    expect(state.node_id).toBe('node-clean');
    expect(state.current_term).toBe(0);
    expect(state.last_log_index).toBe(0);
  });

  it('sanitizes negative counters from persisted raft state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-edge-'));
    tempDirs.push(dir);

    writeFileSync(
      join(dir, 'raft-state.json'),
      JSON.stringify({
        node_id: 'node-x',
        current_term: -7,
        voted_for: 'node-y',
        leader_id: 'node-z',
        commit_index: -3,
        last_applied: -4,
        last_log_index: -5,
        last_log_term: -6,
      }),
      'utf-8'
    );

    const store = new RaftMetadataStore({ clusterDir: dir, nodeId: 'node-clean' });
    const state = store.getState();

    expect(state.current_term).toBe(0);
    expect(state.commit_index).toBe(0);
    expect(state.last_applied).toBe(0);
    expect(state.last_log_index).toBe(0);
    expect(state.last_log_term).toBe(0);
  });

  it('uses current term as default appendEntry term when omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-edge-'));
    tempDirs.push(dir);

    const store = new RaftMetadataStore({ clusterDir: dir, nodeId: 'node-term' });
    store.setState({ current_term: 9 });
    const entry = store.appendEntry({ type: 'runtime', metadata: { event: 'append' } });

    expect(entry.term).toBe(9);
    expect(store.getState().last_log_term).toBe(9);
  });

  it('appends cluster events to log in deterministic sort order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-edge-'));
    tempDirs.push(dir);

    const store = new RaftMetadataStore({ clusterDir: dir, nodeId: 'node-sort' });
    const events: ClusterEvent[] = [
      buildEvent({
        event_id: 'e-3',
        table_name: 'stories',
        row_id: 'S-3',
        version: { actor_id: 'node-a', actor_counter: 3, logical_ts: 200 },
      }),
      buildEvent({
        event_id: 'e-1',
        table_name: 'stories',
        row_id: 'S-1',
        version: { actor_id: 'node-b', actor_counter: 1, logical_ts: 100 },
      }),
      buildEvent({
        event_id: 'e-2',
        table_name: 'stories',
        row_id: 'S-2',
        version: { actor_id: 'node-a', actor_counter: 2, logical_ts: 100 },
      }),
    ];

    store.appendClusterEvents(events, 4);

    const lines = readFileSync(join(dir, 'raft-log.ndjson'), 'utf-8').trim().split('\n');
    const logged = lines
      .map(line => JSON.parse(line) as DurableRaftLogEntry)
      .filter(entry => entry.type === 'cluster_event')
      .map(entry => entry.event_id);

    expect(logged).toEqual(['e-2', 'e-1', 'e-3']);
  });

  it('tracks known event ids through hasEvent lookups', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-edge-'));
    tempDirs.push(dir);

    const store = new RaftMetadataStore({ clusterDir: dir, nodeId: 'node-has' });
    expect(store.hasEvent('event-known')).toBe(false);

    store.appendEntry({
      type: 'cluster_event',
      eventId: 'event-known',
      metadata: { note: 'known now' },
    });

    expect(store.hasEvent('event-known')).toBe(true);
  });
});

describe('distributed runtime endpoint and election edge cases', () => {
  it('treats disabled runtime as leader and allows start/stop no-op', async () => {
    const runtime = new ClusterRuntime({
      enabled: false,
      node_id: 'node-disabled',
      listen_host: '127.0.0.1',
      listen_port: 8787,
      public_url: 'http://127.0.0.1:8787',
      peers: [],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 100,
      election_timeout_max_ms: 200,
      sync_interval_ms: 200,
      request_timeout_ms: 300,
      story_similarity_threshold: 0.8,
    });

    await runtime.start();
    const status = runtime.getStatus();

    expect(runtime.isEnabled()).toBe(false);
    expect(runtime.isLeader()).toBe(true);
    expect(status.enabled).toBe(false);
    expect(status.is_leader).toBe(true);

    await runtime.stop();
  });

  it('uses default delta limit and ignores invalid version vector values', async () => {
    if (!(await canListenOnLocalhost())) return;

    const { runtime, config } = await startRuntimeFixture({
      node_id: 'node-delta-defaults',
    });
    const db = await createTestDatabase();

    insertStory(db, 'S-D1', 'One', 'One');
    insertStory(db, 'S-D2', 'Two', 'Two');
    insertStory(db, 'S-D3', 'Three', 'Three');
    await runtime.sync(db);

    const res = await fetch(`${config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_vector: {
          [config.node_id]: -12,
          bad_actor: 'not-a-number',
        },
        limit: -1,
      }),
    });
    const body = (await res.json()) as {
      events: Array<{ event_id: string }>;
      version_vector: Record<string, number>;
    };

    expect(res.status).toBe(200);
    expect(body.events.length).toBe(3);
    expect(body.version_vector[config.node_id]).toBe(3);

    db.close();
  });

  it('allows repeated votes for same candidate in term and rejects different candidate', async () => {
    if (!(await canListenOnLocalhost())) return;

    const { runtime, config } = await startRuntimeFixture({
      node_id: 'node-vote-repeat',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
    });

    const first = await postJson(config.public_url, '/cluster/v1/election/request-vote', {
      term: 8,
      candidate_id: 'candidate-a',
    });
    const second = await postJson(config.public_url, '/cluster/v1/election/request-vote', {
      term: 8,
      candidate_id: 'candidate-a',
    });
    const third = await postJson(config.public_url, '/cluster/v1/election/request-vote', {
      term: 8,
      candidate_id: 'candidate-b',
    });

    expect(first.vote_granted).toBe(true);
    expect(second.vote_granted).toBe(true);
    expect(third.vote_granted).toBe(false);
    expect(runtime.getStatus().voted_for).toBe('candidate-a');
  });
});

function insertStory(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
  id: string,
  title: string,
  description: string,
  status:
    | 'draft'
    | 'estimated'
    | 'planned'
    | 'in_progress'
    | 'review'
    | 'qa'
    | 'qa_failed'
    | 'pr_submitted'
    | 'merged' = 'planned',
  complexityScore: number | null = null,
  storyPoints: number | null = null
): void {
  const now = new Date().toISOString();
  run(
    db,
    `
    INSERT INTO stories (id, title, description, status, complexity_score, story_points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [id, title, description, status, complexityScore, storyPoints, now, now]
  );
}

function storyPayload(
  id: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    requirement_id: null,
    team_id: null,
    title: `Story ${id}`,
    description: `Description ${id}`,
    acceptance_criteria: null,
    complexity_score: null,
    story_points: null,
    status: 'planned',
    assigned_agent_id: null,
    branch_name: null,
    pr_url: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildEvent(input: {
  event_id: string;
  table_name: ClusterEvent['table_name'];
  row_id: string;
  op?: ClusterEvent['op'];
  payload?: Record<string, unknown> | null;
  version?: ClusterEvent['version'];
}): ClusterEvent {
  return {
    event_id: input.event_id,
    table_name: input.table_name,
    row_id: input.row_id,
    op: input.op || 'upsert',
    payload: input.payload === undefined ? storyPayload(input.row_id) : input.payload,
    version:
      input.version ||
      ({
        actor_id: 'node-a',
        actor_counter: 1,
        logical_ts: Date.now(),
      } satisfies ClusterEvent['version']),
    created_at: new Date().toISOString(),
  };
}

async function startRuntimeFixture(overrides: Partial<ClusterConfig>): Promise<{
  runtime: ClusterRuntime;
  config: ClusterConfig;
}> {
  const port = overrides.listen_port ?? (await getFreePort());
  const config: ClusterConfig = {
    enabled: true,
    node_id: 'node-edge',
    listen_host: '127.0.0.1',
    listen_port: port,
    peers: [],
    heartbeat_interval_ms: 100,
    election_timeout_min_ms: 120,
    election_timeout_max_ms: 240,
    sync_interval_ms: 200,
    request_timeout_ms: 500,
    story_similarity_threshold: 0.8,
    ...overrides,
    public_url: overrides.public_url || `http://127.0.0.1:${port}`,
  };

  const dir = mkdtempSync(join(tmpdir(), `hive-runtime-edge-${config.node_id}-`));
  tempDirs.push(dir);
  const hiveDir = join(dir, '.hive');
  mkdirSync(hiveDir, { recursive: true });

  const runtime = new ClusterRuntime(config, { hiveDir });
  await runtime.start();
  activeRuntimes.push(runtime);

  return { runtime, config };
}

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, any>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, any>;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate free port')));
        return;
      }

      const port = address.port;
      server.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function canListenOnLocalhost(): Promise<boolean> {
  try {
    await getFreePort();
    return true;
  } catch {
    return false;
  }
}
