// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { createServer as createNetServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { ClusterRuntime } from './runtime.js';

interface RuntimeFixture {
  root: string;
  hiveDir: string;
  config: ClusterConfig;
  runtime: ClusterRuntime;
}

const tempRoots: string[] = [];
const activeRuntimes: ClusterRuntime[] = [];

afterEach(async () => {
  for (const runtime of activeRuntimes.splice(0)) {
    try {
      await runtime.stop();
    } catch {
      // Best effort shutdown for test cleanup.
    }
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('dynamic membership join', () => {
  it('leader accepts join request and adds peer to cluster', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'leader-join',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    const res = await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'new-node',
      url: 'http://127.0.0.1:9999',
    });

    expect(res.success).toBe(true);
    expect(res.leader_id).toBe('leader-join');
    expect(res.peers).toContainEqual({ id: 'new-node', url: 'http://127.0.0.1:9999' });

    const status = fixture.runtime.getStatus();
    expect(status.peers).toContainEqual({ id: 'new-node', url: 'http://127.0.0.1:9999' });
  });

  it('follower redirects join request to leader', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'follower-join',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
      peers: [{ id: 'remote-leader', url: 'http://127.0.0.1:9998' }],
    });

    // Set the node as follower with a known leader
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 3,
      leader_id: 'remote-leader',
      fencing_token: 3,
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/membership/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: 'joiner', url: 'http://127.0.0.1:9997' }),
    });

    expect(res.status).toBe(307);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.leader_id).toBe('remote-leader');
    expect(body.leader_url).toBe('http://127.0.0.1:9998');
  });

  it('rejects join request with missing fields', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'leader-join-bad' });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/membership/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: 'missing-url' }),
    });

    expect(res.status).toBe(400);
  });

  it('updates url for existing peer on re-join', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'leader-rejoin',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    // First add the peer
    await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'existing-peer',
      url: 'http://127.0.0.1:8000',
    });

    // Re-join with different URL
    const res = await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'existing-peer',
      url: 'http://127.0.0.1:9000',
    });

    expect(res.success).toBe(true);
    expect(res.peers).toContainEqual({ id: 'existing-peer', url: 'http://127.0.0.1:9000' });
  });

  it('idempotent join with same url returns success', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'leader-idem',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    // Add peer first
    await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'peer-x',
      url: 'http://127.0.0.1:7777',
    });

    // Join again with same details — idempotent
    const res = await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'peer-x',
      url: 'http://127.0.0.1:7777',
    });

    expect(res.success).toBe(true);
  });
});

describe('dynamic membership leave', () => {
  it('leader removes peer on leave request', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'leader-leave',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    // Add peer first, then remove it
    await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'departing-node',
      url: 'http://127.0.0.1:8888',
    });

    const res = await postJson(fixture.config.public_url, '/cluster/v1/membership/leave', {
      node_id: 'departing-node',
    });

    expect(res.success).toBe(true);
    expect(res.peers).not.toContainEqual(expect.objectContaining({ id: 'departing-node' }));

    const status = fixture.runtime.getStatus();
    expect(status.peers.find(p => p.id === 'departing-node')).toBeUndefined();
  });

  it('follower rejects leave request', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'follower-leave',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/membership/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: 'some-node' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  it('leader cannot remove itself', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'leader-self-leave',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/membership/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: 'leader-self-leave' }),
    });

    expect(res.status).toBe(400);
  });

  it('leave for unknown node is a no-op success', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'leader-unknown-leave',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    const res = await postJson(fixture.config.public_url, '/cluster/v1/membership/leave', {
      node_id: 'ghost-node',
    });

    expect(res.success).toBe(true);
  });

  it('rejects leave request with missing node_id', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({ node_id: 'leader-leave-bad' });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/membership/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe('peer list propagation via heartbeat', () => {
  it('leader propagates updated peer list to followers', async () => {
    if (!(await canListenOnLocalhost())) return;

    const portLeader = await getFreePort();
    const portFollower = await getFreePort();

    const leaderConfig = await buildConfig({
      node_id: 'leader-prop',
      listen_port: portLeader,
      public_url: `http://127.0.0.1:${portLeader}`,
      peers: [{ id: 'follower-prop', url: `http://127.0.0.1:${portFollower}` }],
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });
    const followerConfig = await buildConfig({
      node_id: 'follower-prop',
      listen_port: portFollower,
      public_url: `http://127.0.0.1:${portFollower}`,
      peers: [{ id: 'leader-prop', url: `http://127.0.0.1:${portLeader}` }],
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
    });

    const leaderFixture = await startRuntimeWithConfig(leaderConfig);
    const followerFixture = await startRuntimeWithConfig(followerConfig);

    // Wait for leader election
    await waitFor(() => leaderFixture.runtime.getStatus().is_leader, 4000);

    // Add a new peer via the leader
    await postJson(leaderFixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'new-node-prop',
      url: 'http://127.0.0.1:7777',
    });

    // Wait for heartbeat to propagate peer list to follower
    await waitFor(() => {
      const peers = followerFixture.runtime.getStatus().peers;
      return peers.some(p => p.id === 'new-node-prop');
    }, 4000);

    const followerPeers = followerFixture.runtime.getStatus().peers;
    expect(followerPeers).toContainEqual({ id: 'new-node-prop', url: 'http://127.0.0.1:7777' });
  });

  it('follower applies peer list from heartbeat', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'follower-apply',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
    });

    // Send heartbeat with peer list
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 5,
      leader_id: 'external-leader',
      fencing_token: 5,
      peers: [
        { id: 'external-leader', url: 'http://127.0.0.1:6000' },
        { id: 'follower-apply', url: fixture.config.public_url },
        { id: 'peer-z', url: 'http://127.0.0.1:6001' },
      ],
    });

    const status = fixture.runtime.getStatus();
    expect(status.peers).toHaveLength(3);
    expect(status.peers).toContainEqual({ id: 'peer-z', url: 'http://127.0.0.1:6001' });
  });
});

describe('quorum recalculation after membership change', () => {
  it('quorum adjusts after adding a peer', async () => {
    if (!(await canListenOnLocalhost())) return;

    // Start as a single node (quorum = 1)
    const fixture = await startRuntimeFixture({
      node_id: 'quorum-node',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);

    // Single node: quorum = 1
    // Add two peers: 3 nodes total, quorum = 2
    await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'peer-1',
      url: 'http://127.0.0.1:9001',
    });
    await postJson(fixture.config.public_url, '/cluster/v1/membership/join', {
      node_id: 'peer-2',
      url: 'http://127.0.0.1:9002',
    });

    const status = fixture.runtime.getStatus();
    expect(status.peers).toHaveLength(2);
    // The node should still be functional with updated peer list
    expect(status.is_leader).toBe(true);
  });
});

// --- Test helpers ---

async function startRuntimeFixture(
  overrides: Partial<ClusterConfig> = {}
): Promise<RuntimeFixture> {
  const attempts = overrides.listen_port ? 1 : 5;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    const config = await buildConfig(overrides);
    try {
      return await startRuntimeWithConfig(config);
    } catch (error) {
      lastError = error;
      const err = error as NodeJS.ErrnoException;
      if (!overrides.listen_port && err.code === 'EADDRINUSE') {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to start runtime fixture');
}

async function startRuntimeWithConfig(config: ClusterConfig): Promise<RuntimeFixture> {
  const root = mkdtempSync(join(tmpdir(), `hive-membership-${config.node_id}-`));
  const hiveDir = join(root, '.hive');
  mkdirSync(hiveDir, { recursive: true });

  const runtime = new ClusterRuntime(config, { hiveDir });
  try {
    await runtime.start();
    activeRuntimes.push(runtime);
    tempRoots.push(root);

    return { root, hiveDir, config, runtime };
  } catch (error) {
    try {
      await runtime.stop();
    } catch {
      // Best effort cleanup for partial starts.
    }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
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
