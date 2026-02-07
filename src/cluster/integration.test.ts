import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { createServer } from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { createDatabase, queryAll, type DatabaseClient } from '../db/client.js';
import { ClusterRuntime } from './runtime.js';

interface NodeFixture {
  id: string;
  root: string;
  hiveDir: string;
  port: number;
  config: ClusterConfig;
  db: DatabaseClient;
  runtime: ClusterRuntime;
}

const activeRoots: string[] = [];

afterEach(() => {
  for (const root of activeRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('cluster integration harness', () => {
  it('elects a single leader across three nodes', async () => {
    if (!(await canListenOnLocalhost())) {
      return;
    }

    const fixtures = await createClusterFixtures(['node-a', 'node-b', 'node-c']);

    try {
      const leaderId = await waitForSingleLeader(fixtures, 8000);
      expect(leaderId).not.toBeNull();

      const leaders = fixtures.filter(fixture => fixture.runtime.getStatus().is_leader);
      expect(leaders).toHaveLength(1);

      const leader = leaders[0].runtime.getStatus();
      expect(leader.term).toBeGreaterThan(0);
    } finally {
      await stopFixtures(fixtures);
    }
  });

  it('syncs state across two nodes and merges duplicate stories', async () => {
    if (!(await canListenOnLocalhost())) {
      return;
    }

    const fixtures = await createClusterFixtures(['node-a', 'node-b']);

    try {
      const nodeA = fixtures[0];
      const nodeB = fixtures[1];

      insertStory(nodeA.db, 'STORY-A001', 'Add telemetry', 'Add telemetry event pipeline');
      insertStory(nodeA.db, 'STORY-E001', 'Implement OAuth Login', 'Implement oauth2 login with pkce flow');

      insertStory(nodeB.db, 'STORY-B001', 'Build dashboard', 'Build dashboard widgets and filters');
      insertStory(nodeB.db, 'STORY-C001', 'Harden auth', 'Add auth token rotation checks');
      insertStory(nodeB.db, 'STORY-E002', 'Implement OAuth Login', 'Implement oauth2 login with pkce');

      for (let i = 0; i < 20; i++) {
        for (const fixture of fixtures) {
          await fixture.runtime.sync(fixture.db.db);
          fixture.db.save();
        }
        await sleep(100);
      }

      const idsA = queryAll<{ id: string }>(nodeA.db.db, 'SELECT id FROM stories ORDER BY id').map(
        row => row.id
      );
      const idsB = queryAll<{ id: string }>(nodeB.db.db, 'SELECT id FROM stories ORDER BY id').map(
        row => row.id
      );

      expect(idsA).toEqual(idsB);
      expect(idsA).toContain('STORY-E001');
      expect(idsA).not.toContain('STORY-E002');
      expect(idsA).toEqual(
        expect.arrayContaining(['STORY-A001', 'STORY-B001', 'STORY-C001', 'STORY-E001'])
      );
    } finally {
      await stopFixtures(fixtures);
    }
  });
});

async function createClusterFixtures(nodeIds: string[]): Promise<NodeFixture[]> {
  const ports = await Promise.all(nodeIds.map(() => getFreePort()));

  const configs = nodeIds.map((nodeId, index) => {
    const peers = nodeIds
      .map((id, peerIdx) => ({ id, port: ports[peerIdx] }))
      .filter(peer => peer.id !== nodeId)
      .map(peer => ({ id: peer.id, url: `http://127.0.0.1:${peer.port}` }));

    return {
      nodeId,
      port: ports[index],
      config: {
        enabled: true,
        node_id: nodeId,
        listen_host: '127.0.0.1',
        listen_port: ports[index],
        public_url: `http://127.0.0.1:${ports[index]}`,
        peers,
        heartbeat_interval_ms: 150,
        election_timeout_min_ms: 300,
        election_timeout_max_ms: 600,
        sync_interval_ms: 200,
        request_timeout_ms: 1000,
        story_similarity_threshold: 0.8,
      } satisfies ClusterConfig,
    };
  });

  const fixtures: NodeFixture[] = [];

  for (const item of configs) {
    const root = mkdtempSync(join(tmpdir(), `hive-cluster-${item.nodeId}-`));
    activeRoots.push(root);

    const hiveDir = join(root, '.hive');
    mkdirSync(hiveDir, { recursive: true });

    const db = await createDatabase(join(hiveDir, 'hive.db'));
    db.runMigrations();

    const runtime = new ClusterRuntime(item.config, { hiveDir });
    await runtime.start();

    fixtures.push({
      id: item.nodeId,
      root,
      hiveDir,
      port: item.port,
      config: item.config,
      db,
      runtime,
    });
  }

  return fixtures;
}

async function stopFixtures(fixtures: NodeFixture[]): Promise<void> {
  for (const fixture of fixtures) {
    await fixture.runtime.stop();
    fixture.db.close();
  }
}

function insertStory(db: DatabaseClient, id: string, title: string, description: string): void {
  const now = new Date().toISOString();
  db.db.run(
    `
    INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
    VALUES (?, NULL, NULL, ?, ?, 'planned', ?, ?)
  `,
    [id, title, description, now, now]
  );
  db.save();
}

async function waitForSingleLeader(
  fixtures: NodeFixture[],
  timeoutMs: number
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const leaders = fixtures.filter(fixture => fixture.runtime.getStatus().is_leader);
    if (leaders.length === 1) {
      return leaders[0].id;
    }
    await sleep(100);
  }
  return null;
}

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

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function canListenOnLocalhost(): Promise<boolean> {
  try {
    await getFreePort();
    return true;
  } catch {
    return false;
  }
}
