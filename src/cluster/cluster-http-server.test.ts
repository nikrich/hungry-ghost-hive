// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createServer } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { ClusterHttpServer, type ClusterHttpHandlers } from './cluster-http-server.js';

function makeConfig(port: number, authToken?: string): ClusterConfig {
  return {
    enabled: true,
    node_id: 'test-node',
    listen_host: '127.0.0.1',
    listen_port: port,
    public_url: `http://127.0.0.1:${port}`,
    peers: [],
    heartbeat_interval_ms: 2000,
    election_timeout_min_ms: 3000,
    election_timeout_max_ms: 6000,
    sync_interval_ms: 5000,
    request_timeout_ms: 5000,
    story_similarity_threshold: 0.92,
    ...(authToken ? { auth_token: authToken } : {}),
  };
}

function makeHandlers(): ClusterHttpHandlers {
  return {
    getStatus: vi.fn().mockReturnValue({}),
    handleVoteRequest: vi.fn().mockReturnValue({}),
    handleHeartbeat: vi.fn().mockReturnValue({}),
    getDeltaFromCache: vi.fn().mockReturnValue([]),
    getVersionVectorCache: vi.fn().mockReturnValue({}),
    getReplicationLag: vi.fn().mockReturnValue({}),
    getFencingToken: vi.fn().mockReturnValue(0),
    validateFencingToken: vi.fn().mockReturnValue(true),
    isLeaderLeaseValid: vi.fn().mockReturnValue(true),
    handleMembershipJoin: vi.fn().mockReturnValue({ success: true, leader_id: null, leader_url: null, peers: [], term: 1 }),
    handleMembershipLeave: vi.fn().mockReturnValue({ success: true, peers: [] }),
    getSnapshot: vi.fn().mockReturnValue({}),
  };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('Could not get free port'));
      });
    });
  });
}

describe('ClusterHttpServer /healthz', () => {
  let server: ClusterHttpServer;
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
    server = new ClusterHttpServer(makeConfig(port), makeHandlers());
    await server.startServer();
  });

  afterEach(async () => {
    await server.stopServer();
  });

  it('returns 200 with status ok and a numeric timestamp', async () => {
    const before = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; timestamp: number };
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('number');
    expect(body.timestamp).toBeGreaterThanOrEqual(before);
    expect(body.timestamp).toBeLessThanOrEqual(after);
  });

  it('returns 200 without authorization header even when auth token is configured', async () => {
    const authPort = await getFreePort();
    const authServer = new ClusterHttpServer(makeConfig(authPort, 'secret-token'), makeHandlers());
    await authServer.startServer();

    try {
      const res = await fetch(`http://127.0.0.1:${authPort}/healthz`);
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    } finally {
      await authServer.stopServer();
    }
  });
});
