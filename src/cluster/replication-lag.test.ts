// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { createDatabase } from '../db/client.js';
import { ClusterRuntime, fetchReplicationLag } from './runtime.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('replication lag tracking', () => {
  it('returns null when cluster is disabled', async () => {
    const result = await fetchReplicationLag({
      enabled: false,
      node_id: 'node-test',
      listen_host: '127.0.0.1',
      listen_port: 9999,
      public_url: 'http://127.0.0.1:9999',
      peers: [],
      heartbeat_interval_ms: 2000,
      election_timeout_min_ms: 3000,
      election_timeout_max_ms: 6000,
      sync_interval_ms: 5000,
      request_timeout_ms: 5000,
      story_similarity_threshold: 0.92,
    });

    expect(result).toBeNull();
  });

  it('getReplicationLag returns empty peers when no peers configured', async () => {
    if (!(await canListenOnLocalhost())) return;

    const root = mkdtempSync(join(tmpdir(), 'hive-repl-lag-'));
    tempRoots.push(root);
    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const { runtime } = await startRuntimeWithRetries(hiveDir, {
      enabled: true,
      node_id: 'node-lag-test',
      listen_host: '127.0.0.1',
      peers: [],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    const lag = runtime.getReplicationLag();
    expect(lag.node_id).toBe('node-lag-test');
    expect(lag.peers).toEqual([]);
    expect(lag.last_sync_at).toBeNull();
    expect(lag.total_local_events).toBe(0);
    expect(lag.version_vector).toEqual({});

    await runtime.stop();
  });

  it('tracks peer lag after sync with unreachable peer', async () => {
    if (!(await canListenOnLocalhost())) return;

    const root = mkdtempSync(join(tmpdir(), 'hive-repl-lag-unreach-'));
    tempRoots.push(root);
    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const db = await createDatabase(join(hiveDir, 'hive.db'));

    const { runtime } = await startRuntimeWithRetries(hiveDir, {
      enabled: true,
      node_id: 'node-lag-unreach',
      listen_host: '127.0.0.1',
      peers: [
        { id: 'node-lag-unreach', url: 'http://127.0.0.1:1' },
        { id: 'peer-ghost', url: 'http://127.0.0.1:19999' },
      ],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    await runtime.sync(db.db);

    const lag = runtime.getReplicationLag();
    expect(lag.node_id).toBe('node-lag-unreach');
    expect(lag.peers).toHaveLength(1);
    expect(lag.peers[0].peer_id).toBe('peer-ghost');
    expect(lag.peers[0].reachable).toBe(false);
    expect(lag.peers[0].last_sync_at).not.toBeNull();
    expect(lag.peers[0].last_sync_duration_ms).toBeGreaterThanOrEqual(0);
    expect(lag.last_sync_at).not.toBeNull();

    await runtime.stop();
    db.close();
  });

  it('serves replication-lag via HTTP endpoint', async () => {
    if (!(await canListenOnLocalhost())) return;

    const root = mkdtempSync(join(tmpdir(), 'hive-repl-lag-http-'));
    tempRoots.push(root);
    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const { runtime, config } = await startRuntimeWithRetries(hiveDir, {
      enabled: true,
      node_id: 'node-lag-http',
      listen_host: '127.0.0.1',
      peers: [],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    const url = `http://127.0.0.1:${config.listen_port}/cluster/v1/replication-lag`;
    const response = await fetch(url);
    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      node_id: string;
      peers: unknown[];
      last_sync_at: string | null;
    };
    expect(body.node_id).toBe('node-lag-http');
    expect(body.peers).toEqual([]);
    expect(body.last_sync_at).toBeNull();

    await runtime.stop();
  });

  it('tracks lag for reachable peer with events', async () => {
    if (!(await canListenOnLocalhost())) return;

    const root = mkdtempSync(join(tmpdir(), 'hive-repl-lag-two-'));
    tempRoots.push(root);
    const hiveDirA = join(root, '.hive-a');
    const hiveDirB = join(root, '.hive-b');
    mkdirSync(hiveDirA, { recursive: true });
    mkdirSync(hiveDirB, { recursive: true });

    const dbA = await createDatabase(join(hiveDirA, 'hive.db'));
    const dbB = await createDatabase(join(hiveDirB, 'hive.db'));

    // Start node B first (the peer)
    const { runtime: runtimeB, config: configB } = await startRuntimeWithRetries(hiveDirB, {
      enabled: true,
      node_id: 'node-b',
      listen_host: '127.0.0.1',
      peers: [],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    // Insert data on node B and sync so it has events in cache
    dbB.db.run(
      `INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
       VALUES ('STORY-B1', NULL, NULL, 'Story from B', 'Test story', 'planned', ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()]
    );
    await runtimeB.sync(dbB.db);
    dbB.save();

    // Start node A with node B as a peer
    const { runtime: runtimeA } = await startRuntimeWithRetries(hiveDirA, {
      enabled: true,
      node_id: 'node-a',
      listen_host: '127.0.0.1',
      peers: [
        { id: 'node-a', url: 'http://127.0.0.1:1' },
        { id: 'node-b', url: `http://127.0.0.1:${configB.listen_port}` },
      ],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    // Sync node A - it should pull events from B
    await runtimeA.sync(dbA.db);

    const lag = runtimeA.getReplicationLag();
    expect(lag.node_id).toBe('node-a');
    expect(lag.peers).toHaveLength(1);
    expect(lag.peers[0].peer_id).toBe('node-b');
    expect(lag.peers[0].reachable).toBe(true);
    expect(lag.peers[0].events_behind).toBeGreaterThanOrEqual(0);
    expect(lag.peers[0].last_sync_at).not.toBeNull();
    expect(lag.peers[0].last_sync_duration_ms).toBeGreaterThanOrEqual(0);
    expect(lag.last_sync_at).not.toBeNull();

    await runtimeA.stop();
    await runtimeB.stop();
    dbA.close();
    dbB.close();
  });
});

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
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

async function startRuntimeWithRetries(
  hiveDir: string,
  baseConfig: Omit<ClusterConfig, 'listen_port' | 'public_url'>,
  attempts = 5
): Promise<{ runtime: ClusterRuntime; config: ClusterConfig }> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    const port = await getFreePort();
    const config: ClusterConfig = {
      ...baseConfig,
      listen_port: port,
      public_url: `http://127.0.0.1:${port}`,
    };

    const runtime = new ClusterRuntime(config, { hiveDir });

    try {
      await runtime.start();
      return { runtime, config };
    } catch (error) {
      lastError = error;
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to start cluster runtime');
}
