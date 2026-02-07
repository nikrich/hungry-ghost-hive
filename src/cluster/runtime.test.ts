import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { createServer } from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { createDatabase } from '../db/client.js';
import { ClusterRuntime, fetchLocalClusterStatus } from './runtime.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('cluster runtime helpers', () => {
  it('returns synthetic leader status when cluster mode is disabled', async () => {
    const status = await fetchLocalClusterStatus({
      enabled: false,
      node_id: 'node-local',
      listen_host: '0.0.0.0',
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
    expect(status?.is_leader).toBe(true);
    expect(status?.role).toBe('leader');
    expect(status?.node_id).toBe('node-local');
    expect(status?.raft_last_log_index).toBe(0);
  });

  it('persists durable raft term and log metadata across restart', async () => {
    if (!(await canListenOnLocalhost())) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'hive-cluster-runtime-'));
    tempRoots.push(root);

    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const db = await createDatabase(join(hiveDir, 'hive.db'));
    const port = await getFreePort();
    const config: ClusterConfig = {
      enabled: true,
      node_id: 'node-persist',
      listen_host: '127.0.0.1',
      listen_port: port,
      public_url: `http://127.0.0.1:${port}`,
      peers: [],
      heartbeat_interval_ms: 100,
      election_timeout_min_ms: 150,
      election_timeout_max_ms: 250,
      sync_interval_ms: 200,
      request_timeout_ms: 500,
      story_similarity_threshold: 0.92,
    };

    const runtimeA = new ClusterRuntime(config, { hiveDir });
    await runtimeA.start();

    db.db.run(
      `
      INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
      VALUES ('STORY-PERSIST', NULL, NULL, 'Persist me', 'Ensure durable raft metadata', 'planned', ?, ?)
    `,
      [new Date().toISOString(), new Date().toISOString()]
    );

    await runtimeA.sync(db.db);
    db.save();

    const statusBefore = runtimeA.getStatus();
    expect(statusBefore.raft_last_log_index).toBeGreaterThan(0);

    await runtimeA.stop();

    const runtimeB = new ClusterRuntime(config, { hiveDir });
    await runtimeB.start();

    const statusAfter = runtimeB.getStatus();
    expect(statusAfter.raft_last_log_index).toBeGreaterThanOrEqual(statusBefore.raft_last_log_index);
    expect(statusAfter.term).toBeGreaterThanOrEqual(statusBefore.term);

    const statePath = join(hiveDir, 'cluster', 'raft-state.json');
    const logPath = join(hiveDir, 'cluster', 'raft-log.ndjson');
    expect(existsSync(statePath)).toBe(true);
    expect(existsSync(logPath)).toBe(true);

    const state = JSON.parse(readFileSync(statePath, 'utf-8')) as { current_term: number };
    expect(state.current_term).toBeGreaterThanOrEqual(0);

    await runtimeB.stop();
    db.close();
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
