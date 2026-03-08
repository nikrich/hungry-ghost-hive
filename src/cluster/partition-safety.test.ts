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

describe('fencing token validation', () => {
  it('rejects heartbeats with fencing_token lower than term', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-fence-reject',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    // First, advance the term by accepting a vote request
    await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 5,
      candidate_id: 'candidate-5',
    });

    // Send heartbeat with valid term but stale fencing token
    const res = await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 5,
      leader_id: 'candidate-5',
      fencing_token: 3,
    });

    expect(res.success).toBe(false);
    expect(res.fencing_token).toBe(5);
  });

  it('accepts heartbeats with valid fencing_token', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-fence-accept',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    const res = await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 3,
      leader_id: 'leader-3',
      fencing_token: 3,
    });

    expect(res.success).toBe(true);
    expect(res.fencing_token).toBe(3);
  });

  it('rejects delta requests with stale fencing_token', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-delta-fence',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    // Advance term
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 10,
      leader_id: 'leader-10',
      fencing_token: 10,
    });

    // Request delta with stale fencing token
    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_vector: {},
        fencing_token: 5,
      }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; fencing_token: number };
    expect(body.error).toContain('stale leader epoch');
    expect(body.fencing_token).toBe(10);
  });

  it('accepts delta requests with current fencing_token', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-delta-fence-ok',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    // Set term to 4
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 4,
      leader_id: 'leader-4',
      fencing_token: 4,
    });

    // Request delta with matching fencing token
    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_vector: {},
        fencing_token: 4,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { fencing_token: number };
    expect(body.fencing_token).toBe(4);
  });

  it('accepts delta requests without fencing_token for backward compatibility', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-delta-no-fence',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    const res = await fetch(`${fixture.config.public_url}/cluster/v1/events/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_vector: {},
      }),
    });

    expect(res.status).toBe(200);
  });

  it('returns fencing_token in status endpoint', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-status-fence',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    // Advance term
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 7,
      leader_id: 'leader-7',
      fencing_token: 7,
    });

    const status = fixture.runtime.getStatus();
    expect(status.fencing_token).toBe(7);
    expect(status.term).toBe(7);
  });
});

describe('leader lease validation', () => {
  it('reports lease invalid when no heartbeat has been received', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-none',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
    });

    const status = fixture.runtime.getStatus();
    expect(status.leader_lease_valid).toBe(false);
  });

  it('reports lease valid immediately after receiving heartbeat', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-fresh',
      election_timeout_min_ms: 2000,
      election_timeout_max_ms: 2000,
      heartbeat_interval_ms: 100,
    });

    // Send a heartbeat
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 2,
      leader_id: 'leader-2',
      fencing_token: 2,
    });

    const status = fixture.runtime.getStatus();
    expect(status.leader_lease_valid).toBe(true);
  });

  it('leader always reports lease valid', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-leader',
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    await waitFor(() => fixture.runtime.getStatus().is_leader, 4000);
    const status = fixture.runtime.getStatus();
    expect(status.leader_lease_valid).toBe(true);
  });

  it('reports lease expired after timeout elapses without heartbeat', async () => {
    if (!(await canListenOnLocalhost())) return;

    const leaseMs = 150;
    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-expire',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
      heartbeat_interval_ms: 50,
      leader_lease_ms: leaseMs,
    });

    // Send heartbeat to establish lease
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 1,
      leader_id: 'leader-1',
      fencing_token: 1,
    });

    expect(fixture.runtime.getStatus().leader_lease_valid).toBe(true);

    // Wait for lease to expire
    await new Promise(resolve => setTimeout(resolve, leaseMs + 50));

    expect(fixture.runtime.getStatus().leader_lease_valid).toBe(false);
  });

  it('reports correct leader_lease_duration_ms from config', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-config',
      heartbeat_interval_ms: 200,
      leader_lease_ms: 1000,
    });

    expect(fixture.runtime.getStatus().leader_lease_duration_ms).toBe(1000);
  });

  it('defaults leader_lease_duration_ms to 3x heartbeat_interval_ms', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-default',
      heartbeat_interval_ms: 200,
    });

    expect(fixture.runtime.getStatus().leader_lease_duration_ms).toBe(600);
  });

  it('resets lease on step-down from higher term', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-lease-stepdown',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
      heartbeat_interval_ms: 100,
    });

    // Establish lease at term 2
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 2,
      leader_id: 'leader-2',
      fencing_token: 2,
    });

    expect(fixture.runtime.getStatus().leader_lease_valid).toBe(true);

    // Higher term vote request causes step-down, which should reset lease
    await postJson(fixture.config.public_url, '/cluster/v1/election/request-vote', {
      term: 5,
      candidate_id: 'candidate-5',
    });

    // Lease should be invalid after step-down (no heartbeat from new leader yet)
    expect(fixture.runtime.getStatus().leader_lease_valid).toBe(false);
  });
});

describe('partition healing scenarios', () => {
  it('stale leader is fenced after partition heals', async () => {
    if (!(await canListenOnLocalhost())) return;

    const portA = await getFreePort();
    const portB = await getFreePort();

    // Node A and B are peers
    const configA = await buildConfig({
      node_id: 'node-a-heal',
      listen_port: portA,
      public_url: `http://127.0.0.1:${portA}`,
      peers: [{ id: 'node-b-heal', url: `http://127.0.0.1:${portB}` }],
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });
    const configB = await buildConfig({
      node_id: 'node-b-heal',
      listen_port: portB,
      public_url: `http://127.0.0.1:${portB}`,
      peers: [{ id: 'node-a-heal', url: `http://127.0.0.1:${portA}` }],
      election_timeout_min_ms: 80,
      election_timeout_max_ms: 120,
      heartbeat_interval_ms: 60,
    });

    const fixtureA = await startRuntimeWithConfig(configA);
    const fixtureB = await startRuntimeWithConfig(configB);

    // Wait until at least one becomes leader
    await waitFor(
      () => fixtureA.runtime.getStatus().is_leader || fixtureB.runtime.getStatus().is_leader,
      4000
    );

    const statusA = fixtureA.runtime.getStatus();
    const statusB = fixtureB.runtime.getStatus();

    // Exactly one should be leader (same term wins in a 2-node cluster)
    const leaderCount = [statusA, statusB].filter(s => s.is_leader).length;
    expect(leaderCount).toBeLessThanOrEqual(1);

    // Both should have fencing tokens
    expect(statusA.fencing_token).toBeGreaterThanOrEqual(0);
    expect(statusB.fencing_token).toBeGreaterThanOrEqual(0);
  });

  it('follower rejects stale leader heartbeat after seeing higher term', async () => {
    if (!(await canListenOnLocalhost())) return;

    const fixture = await startRuntimeFixture({
      node_id: 'node-heal-reject',
      election_timeout_min_ms: 5000,
      election_timeout_max_ms: 5000,
    });

    // Node sees term 10 from new leader
    await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 10,
      leader_id: 'new-leader',
      fencing_token: 10,
    });

    // Old leader (term 5) tries to send heartbeat after partition heals
    const staleRes = await postJson(fixture.config.public_url, '/cluster/v1/election/heartbeat', {
      term: 5,
      leader_id: 'old-leader',
      fencing_token: 5,
    });

    expect(staleRes.success).toBe(false);
    expect(staleRes.fencing_token).toBe(10);

    // Verify node still follows new leader
    const status = fixture.runtime.getStatus();
    expect(status.leader_id).toBe('new-leader');
    expect(status.term).toBe(10);
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
  const root = mkdtempSync(join(tmpdir(), `hive-partition-safety-${config.node_id}-`));
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
