// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { createServer as createNetServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { queryAll, queryOne, run } from '../db/client.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { getAllClusterEvents } from './replication.js';
import {
  ClusterRuntime,
  fetchClusterStatusFromUrl,
  fetchLocalClusterStatus,
  type ClusterStatus,
} from './runtime.js';

interface RuntimeFixture {
  root: string;
  hiveDir: string;
  config: ClusterConfig;
  runtime: ClusterRuntime;
}

const tempRoots: string[] = [];
const activeRuntimes: ClusterRuntime[] = [];
const activeServers: HttpServer[] = [];

afterEach(async () => {
  for (const runtime of activeRuntimes.splice(0)) {
    try {
      await runtime.stop();
    } catch {
      // Best effort shutdown for test cleanup.
    }
  }

  for (const server of activeServers.splice(0)) {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('distributed runtime transport and status', () => {
  it('returns null for enabled local status when runtime is not running', async () => {
    if (!(await canListenOnLocalhost())) return;

    const port = await getFreePort();
    const config = await buildConfig({
      node_id: 'node-down',
      listen_port: port,
      public_url: `http://127.0.0.1:${port}`,
    });

    const status = await fetchLocalClusterStatus(config);
    expect(status).toBeNull();
  });

  it('fetches local status when listen_host is 0.0.0.0', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-any',
      listen_host: '0.0.0.0',
      auth_token: 'token-listen-any',
    });

    const status = await fetchLocalClusterStatus(fixture.config);
    expect(status?.node_id).toBe('node-any');
    expect(status?.enabled).toBe(true);
  });

  it('returns null from fetchClusterStatusFromUrl for unreachable host', async () => {
    const status = await fetchClusterStatusFromUrl('http://127.0.0.1:9/cluster/v1/status', {
      timeoutMs: 100,
    });
    expect(status).toBeNull();
  });

  it('parses malformed status payloads into safe defaults', async () => {
    if (!(await canListenOnLocalhost())) return;

    const port = await getFreePort();
    const server = createHttpServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          enabled: 'invalid',
          node_id: 123,
          role: 'invalid-role',
          term: '7.9',
          voted_for: 5,
          is_leader: 'nope',
          leader_id: 8,
          leader_url: false,
          raft_commit_index: '12',
          raft_last_applied: 'oops',
          raft_last_log_index: '9',
          peers: [
            { id: 'peer-a', url: 'http://127.0.0.1:8080' },
            { id: 2, url: 3 },
          ],
        })
      );
    });
    activeServers.push(server);

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });

    const status = await fetchClusterStatusFromUrl(`http://127.0.0.1:${port}/cluster/v1/status`, {
      timeoutMs: 1000,
    });

    expect(status).toEqual({
      enabled: true,
      node_id: 'unknown',
      role: 'follower',
      term: 7,
      voted_for: null,
      is_leader: false,
      leader_id: null,
      leader_url: null,
      raft_commit_index: 12,
      raft_last_applied: 0,
      raft_last_log_index: 9,
      peers: [{ id: 'peer-a', url: 'http://127.0.0.1:8080' }],
    } satisfies ClusterStatus);
  });

  it('requires bearer auth token for status endpoint', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-auth-status',
      auth_token: 'secret-token',
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/status`);
    expect(res.status).toBe(401);
  });

  it('accepts bearer auth token for status endpoint', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-auth-status-ok',
      auth_token: 'secret-token',
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/status`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    const body = (await res.json()) as ClusterStatus;

    expect(res.status).toBe(200);
    expect(body.node_id).toBe('node-auth-status-ok');
  });

  it('requires bearer auth token for vote endpoint', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-auth-vote',
      auth_token: 'token-vote',
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/election/request-vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: 1, candidate_id: 'candidate-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('requires bearer auth token for delta endpoint', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-auth-delta',
      auth_token: 'token-delta',
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_vector: {} }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown cluster endpoint paths', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-unknown-route' });
    const res = await fetch(`${fixture.config.public_url}/cluster/v1/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed JSON request bodies', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-bad-json' });
    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad-json',
    });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('returns 413 for request bodies that exceed the maximum payload size', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-payload-too-large' });
    const largePayload = 'x'.repeat(1_100_000);
    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_vector: {}, largePayload }),
    });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(413);
    expect(body.error).toContain('Payload too large');
  });

  it('returns null status after runtime stop closes HTTP listener', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-stop' });
    await fixture.runtime.stop();

    const status = await fetchLocalClusterStatus(fixture.config);
    expect(status).toBeNull();
  });

  it('includes configured peers in runtime status output', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-peers',
      peers: [
        { id: 'peer-1', url: 'http://127.0.0.1:9001' },
        { id: 'peer-2', url: 'http://127.0.0.1:9002' },
      ],
    });

    const status = fixture.runtime.getStatus();
    expect(status.peers).toEqual([
      { id: 'peer-1', url: 'http://127.0.0.1:9001' },
      { id: 'peer-2', url: 'http://127.0.0.1:9002' },
    ]);
  });
});

describe('distributed runtime election semantics', () => {
  it('elects itself as leader in a single-node runtime', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-solo-leader',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);
    const status = fixture.runtime.getStatus();

    expect(status.is_leader).toBe(true);
    expect(status.role).toBe('leader');
    expect(status.leader_id).toBe('node-solo-leader');
    expect(status.term).toBeGreaterThan(0);
  });

  it('starts as follower before election timeout elapses', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-start-follower',
      election_timeout_min_ms: 1000,
      election_timeout_max_ms: 1000,
    });

    const status = fixture.runtime.getStatus();
    expect(status.role).toBe('follower');
    expect(status.is_leader).toBe(false);
    expect(status.leader_id).toBeNull();
  });

  it('grants vote for higher-term vote requests and records voted_for', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-vote-grant',
      election_timeout_min_ms: 1200,
      election_timeout_max_ms: 1200,
    });

    const res = await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 5,
      candidate_id: 'candidate-5',
    });

    expect(res.term).toBe(5);
    expect(res.vote_granted).toBe(true);

    const status = fixture.runtime.getStatus();
    expect(status.term).toBe(5);
    expect(status.voted_for).toBe('candidate-5');
  });

  it('rejects lower-term vote requests after observing a higher term', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-vote-reject',
      election_timeout_min_ms: 1200,
      election_timeout_max_ms: 1200,
    });

    await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 6,
      candidate_id: 'candidate-6',
    });

    const stale = await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 3,
      candidate_id: 'candidate-3',
    });

    expect(stale.term).toBe(6);
    expect(stale.vote_granted).toBe(false);
    expect(fixture.runtime.getStatus().voted_for).toBe('candidate-6');
  });

  it('rejects vote requests with missing candidate id', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-vote-invalid' });
    const res = await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 2,
    });

    expect(res.vote_granted).toBe(false);
  });

  it('rejects heartbeats with stale term', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-heartbeat-stale',
      election_timeout_min_ms: 1200,
      election_timeout_max_ms: 1200,
    });

    await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 4,
      candidate_id: 'candidate-4',
    });

    const res = await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 3,
      leader_id: 'leader-3',
    });

    expect(res.success).toBe(false);
    expect(res.term).toBe(4);
  });

  it('accepts higher-term heartbeats and updates leader id', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-heartbeat-update',
      peers: [{ id: 'leader-7', url: 'http://127.0.0.1:9777' }],
    });

    const res = await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 7,
      leader_id: 'leader-7',
    });

    const status = fixture.runtime.getStatus();
    expect(res.success).toBe(true);
    expect(status.term).toBe(7);
    expect(status.role).toBe('follower');
    expect(status.leader_id).toBe('leader-7');
  });

  it('resolves leader_url to known peer when heartbeat sets peer leader', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-leader-url-peer',
      peers: [{ id: 'peer-leader', url: 'http://127.0.0.1:9555' }],
    });

    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 2,
      leader_id: 'peer-leader',
    });

    expect(fixture.runtime.getStatus().leader_url).toBe('http://127.0.0.1:9555');
  });

  it('sets leader_url to public_url when node becomes leader', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-leader-url-self',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);
    expect(fixture.runtime.getStatus().leader_url).toBe(fixture.config.public_url);
  });

  it('fetchLocalClusterStatus reflects elected leader state', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-fetch-live',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);
    const status = await fetchLocalClusterStatus(fixture.config);

    expect(status?.is_leader).toBe(true);
    expect(status?.leader_id).toBe('node-fetch-live');
    expect(status?.term).toBeGreaterThan(0);
  });
});

describe('distributed runtime sync behavior', () => {
  it('returns zeroed sync metrics when cluster mode is disabled', async () => {
    const db = createTestDatabase();
    const runtime = new ClusterRuntime({
      enabled: false,
      node_id: 'node-disabled',
      listen_host: '127.0.0.1',
      listen_port: 8787,
      public_url: 'http://127.0.0.1:8787',
      peers: [],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 200,
      election_timeout_max_ms: 400,
      sync_interval_ms: 250,
      request_timeout_ms: 300,
      story_similarity_threshold: 0.8,
    });

    const result = await runtime.sync(db);
    expect(result).toEqual({
      local_events_emitted: 0,
      imported_events_applied: 0,
      merged_duplicate_stories: 0,
      durable_log_entries_appended: 0,
    });

    db.close();
  });

  it('emits local events during sync for newly inserted rows', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-sync-local' });
    const db = createTestDatabase();

    insertStory(db, 'STORY-LOCAL-1', 'Local sync story', 'Emit local event on first sync');
    const result = await fixture.runtime.sync(db);

    expect(result.local_events_emitted).toBeGreaterThan(0);
    expect(result.imported_events_applied).toBe(0);
    expect(getAllClusterEvents(db).length).toBeGreaterThan(0);

    db.close();
  });

  it('merges duplicate stories during sync when similarity threshold matches', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-sync-merge',
      story_similarity_threshold: 0.8,
    });
    const db = createTestDatabase();

    insertStory(
      db,
      'STORY-DUP-A',
      'Implement OAuth Login',
      'Implement oauth2 login with pkce flow'
    );
    insertStory(
      db,
      'STORY-DUP-B',
      'Implement OAuth Login',
      'Implement oauth2 login with pkce flow'
    );

    const result = await fixture.runtime.sync(db);
    const ids = queryAll<{ id: string }>(db, 'SELECT id FROM stories ORDER BY id').map(
      row => row.id
    );

    expect(result.merged_duplicate_stories).toBe(1);
    expect(ids).toEqual(['STORY-DUP-A']);

    db.close();
  });

  it('does not append duplicate durable log entries on unchanged sync cycles', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-sync-durable' });
    const db = createTestDatabase();

    insertStory(db, 'STORY-DURABLE-1', 'Durable event', 'Verify dedupe across sync calls');
    const first = await fixture.runtime.sync(db);
    const second = await fixture.runtime.sync(db);

    expect(first.durable_log_entries_appended).toBeGreaterThan(0);
    expect(second.durable_log_entries_appended).toBe(0);

    db.close();
  });

  it('imports remote events from peer runtime during sync', async () => {
    if (!(await canListenOnLocalhost())) return;

    const portA = await getFreePort();
    const portB = await getFreePort();

    const configA = await buildConfig({
      node_id: 'node-a',
      listen_port: portA,
      public_url: `http://127.0.0.1:${portA}`,
      peers: [{ id: 'node-b', url: `http://127.0.0.1:${portB}` }],
    });
    const configB = await buildConfig({
      node_id: 'node-b',
      listen_port: portB,
      public_url: `http://127.0.0.1:${portB}`,
      peers: [{ id: 'node-a', url: `http://127.0.0.1:${portA}` }],
    });

    const fixtureA = await startRuntimeWithConfig(configA);
    const fixtureB = await startRuntimeWithConfig(configB);
    const dbA = createTestDatabase();
    const dbB = createTestDatabase();

    insertStory(dbA, 'STORY-REMOTE-1', 'Peer story', 'This story should replicate to node-b');
    await fixtureA.runtime.sync(dbA);

    const resultB = await fixtureB.runtime.sync(dbB);
    const replicated = queryOne<{ id: string }>(
      dbB,
      `SELECT id FROM stories WHERE id = 'STORY-REMOTE-1'`
    );

    expect(resultB.imported_events_applied).toBeGreaterThan(0);
    expect(replicated?.id).toBe('STORY-REMOTE-1');

    dbA.close();
    dbB.close();
  });

  it('handles unreachable peers without throwing and imports zero events', async () => {
    if (!(await canListenOnLocalhost())) return;

    const deadPort = await getFreePort();
    const fixture = await startRuntimeFixture({
      node_id: 'node-unreachable-peer',
      peers: [{ id: 'node-dead', url: `http://127.0.0.1:${deadPort}` }],
      request_timeout_ms: 150,
    });
    const db = createTestDatabase();

    const result = await fixture.runtime.sync(db);
    expect(result.imported_events_applied).toBe(0);

    db.close();
  });

  it('delta endpoint returns only missing events based on version vector', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-delta-vector' });
    const db = createTestDatabase();

    insertStory(db, 'STORY-DELTA-1', 'Delta 1', 'first');
    insertStory(db, 'STORY-DELTA-2', 'Delta 2', 'second');
    insertStory(db, 'STORY-DELTA-3', 'Delta 3', 'third');
    await fixture.runtime.sync(db);

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_vector: { [fixture.config.node_id]: 2 },
        limit: 100,
      }),
    });
    const body = (await res.json()) as {
      events: Array<{ version: { actor_counter: number } }>;
      version_vector: Record<string, number>;
    };

    expect(res.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].version.actor_counter).toBe(3);
    expect(body.version_vector[fixture.config.node_id]).toBeGreaterThanOrEqual(3);

    db.close();
  });

  it('delta endpoint applies explicit event limit', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'node-delta-limit' });
    const db = createTestDatabase();

    insertStory(db, 'STORY-LIMIT-1', 'Limit 1', 'first');
    insertStory(db, 'STORY-LIMIT-2', 'Limit 2', 'second');
    insertStory(db, 'STORY-LIMIT-3', 'Limit 3', 'third');
    await fixture.runtime.sync(db);

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_vector: {},
        limit: 2,
      }),
    });
    const body = (await res.json()) as { events: unknown[] };

    expect(res.status).toBe(200);
    expect(body.events).toHaveLength(2);

    db.close();
  });
});

async function startRuntimeFixture(
  overrides: Partial<ClusterConfig> = {}
): Promise<RuntimeFixture> {
  const config = await buildConfig(overrides);
  return startRuntimeWithConfig(config);
}

async function startRuntimeWithConfig(config: ClusterConfig): Promise<RuntimeFixture> {
  const root = mkdtempSync(join(tmpdir(), `hive-cluster-runtime-${config.node_id}-`));
  tempRoots.push(root);
  const hiveDir = join(root, '.hive');
  mkdirSync(hiveDir, { recursive: true });

  const runtime = new ClusterRuntime(config, { hiveDir });
  await runtime.start();
  activeRuntimes.push(runtime);

  return {
    root,
    hiveDir,
    config,
    runtime,
  };
}

async function buildConfig(overrides: Partial<ClusterConfig> = {}): Promise<ClusterConfig> {
  const port = overrides.listen_port ?? (await getFreePort());
  const base: ClusterConfig = {
    enabled: true,
    node_id: 'node-test',
    listen_host: '127.0.0.1',
    listen_port: port,
    public_url: `http://127.0.0.1:${port}`,
    peers: [],
    heartbeat_interval_ms: 100,
    election_timeout_min_ms: 150,
    election_timeout_max_ms: 250,
    sync_interval_ms: 200,
    request_timeout_ms: 600,
    story_similarity_threshold: 0.8,
  };

  return {
    ...base,
    ...overrides,
    public_url: overrides.public_url || base.public_url,
    peers: overrides.peers || base.peers,
  };
}

function insertStory(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
  id: string,
  title: string,
  description: string
): void {
  const now = new Date().toISOString();
  run(
    db,
    `
    INSERT INTO stories (id, title, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'planned', ?, ?)
  `,
    [id, title, description, now, now]
  );
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

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition');
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
