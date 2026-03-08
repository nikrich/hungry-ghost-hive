// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { createDatabase } from '../db/client.js';
import { run } from '../db/client.js';
import { ClusterRuntime, fetchLocalClusterStatus, logClusterEvent } from './runtime.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('replication monitoring', () => {
  it('getStatus includes replication metrics with empty defaults', async () => {
    if (!(await canListenOnLocalhost())) return;

    const root = mkdtempSync(join(tmpdir(), 'hive-repl-monitor-'));
    tempRoots.push(root);
    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const { runtime } = await startRuntimeWithRetries(hiveDir, {
      enabled: true,
      node_id: 'node-monitor',
      listen_host: '127.0.0.1',
      peers: [
        { id: 'node-monitor', url: 'http://127.0.0.1:9999' },
        { id: 'node-peer-a', url: 'http://127.0.0.1:9998' },
      ],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    const status = runtime.getStatus();

    expect(status.replication).toBeDefined();
    expect(status.replication.peer_metrics).toHaveLength(1);
    expect(status.replication.peer_metrics[0].peer_id).toBe('node-peer-a');
    expect(status.replication.peer_metrics[0].reachable).toBe(false);
    expect(status.replication.peer_metrics[0].last_sync_at).toBeNull();
    expect(status.replication.local_event_count).toBe(0);
    expect(status.replication.last_sync_at).toBeNull();

    await runtime.stop();
  });

  it('sync populates replication metrics for unreachable peers', async () => {
    if (!(await canListenOnLocalhost())) return;

    const root = mkdtempSync(join(tmpdir(), 'hive-repl-sync-'));
    tempRoots.push(root);
    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const db = await createDatabase(join(hiveDir, 'hive.db'));

    const { runtime } = await startRuntimeWithRetries(hiveDir, {
      enabled: true,
      node_id: 'node-sync-test',
      listen_host: '127.0.0.1',
      peers: [
        { id: 'node-sync-test', url: 'http://127.0.0.1:9999' },
        { id: 'node-unreachable', url: 'http://127.0.0.1:19999' },
      ],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    });

    run(
      db.db,
      `INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
       VALUES ('STORY-MON001', NULL, NULL, 'Test repl monitoring', 'Test story', 'planned', ?, ?)`,
      [new Date().toISOString(), new Date().toISOString()]
    );

    await runtime.sync(db.db);

    const status = runtime.getStatus();
    expect(status.replication.peer_metrics).toHaveLength(1);

    const peerMetric = status.replication.peer_metrics[0];
    expect(peerMetric.peer_id).toBe('node-unreachable');
    expect(peerMetric.reachable).toBe(false);
    expect(peerMetric.last_sync_at).not.toBeNull();
    expect(peerMetric.last_sync_latency_ms).toBeGreaterThanOrEqual(0);

    expect(status.replication.local_event_count).toBeGreaterThan(0);
    expect(status.replication.last_sync_at).not.toBeNull();

    await runtime.stop();
    db.close();
  });

  it('fetchLocalClusterStatus includes replication field when disabled', async () => {
    const status = await fetchLocalClusterStatus({
      enabled: false,
      node_id: 'node-disabled',
      listen_host: '127.0.0.1',
      listen_port: 8787,
      public_url: 'http://127.0.0.1:8787',
      peers: [],
      heartbeat_interval_ms: 2000,
      election_timeout_min_ms: 3000,
      election_timeout_max_ms: 6000,
      sync_interval_ms: 5000,
      request_timeout_ms: 5000,
      story_similarity_threshold: 0.92,
    });

    expect(status).not.toBeNull();
    expect(status!.replication).toBeDefined();
    expect(status!.replication.peer_metrics).toEqual([]);
    expect(status!.replication.local_event_count).toBe(0);
    expect(status!.replication.last_sync_at).toBeNull();
  });

  it('logClusterEvent outputs structured JSON to console', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logClusterEvent('test_event', { foo: 'bar', count: 42 });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.component).toBe('cluster');
    expect(output.event).toBe('test_event');
    expect(output.foo).toBe('bar');
    expect(output.count).toBe(42);
    expect(output.ts).toBeDefined();

    consoleSpy.mockRestore();
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
      server.close(err => (err ? reject(err) : resolve(port)));
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
      if (err.code !== 'EADDRINUSE') throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to start cluster runtime');
}
