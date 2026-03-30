// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createServer } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterConfig } from '../config/schema.js';
import { ClusterHttpServer, type ClusterHttpHandlers } from './cluster-http-server.js';

function makeHandlers(): ClusterHttpHandlers {
  return {
    getStatus: vi.fn().mockReturnValue({ is_leader: false }),
    handleVoteRequest: vi.fn().mockReturnValue({}),
    handleHeartbeat: vi.fn().mockReturnValue({}),
    getDeltaFromCache: vi.fn().mockReturnValue([]),
    getVersionVectorCache: vi.fn().mockReturnValue({}),
    getReplicationLag: vi.fn().mockReturnValue(0),
    getFencingToken: vi.fn().mockReturnValue(0),
    validateFencingToken: vi.fn().mockReturnValue(true),
    isLeaderLeaseValid: vi.fn().mockReturnValue(true),
    handleMembershipJoin: vi.fn().mockReturnValue({ success: true, leader_id: null, leader_url: null, peers: [], term: 0 }),
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
        else reject(new Error('Could not get port'));
      });
    });
  });
}

async function httpGet(port: number, path: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const { request } = await import('http');
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, res => {
      let raw = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('ClusterHttpServer /healthz', () => {
  let server: ClusterHttpServer;
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
    const config: ClusterConfig = {
      node_id: 'test',
      listen_host: '127.0.0.1',
      listen_port: port,
      peers: [],
    };
    server = new ClusterHttpServer(config, makeHandlers());
    await server.startServer();
  });

  afterEach(async () => {
    await server.stopServer();
  });

  it('returns 200 with status ok and a numeric timestamp', async () => {
    const before = Date.now();
    const { status, body } = await httpGet(port, '/healthz');
    const after = Date.now();

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
    const ts = (body as { timestamp: number }).timestamp;
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('returns 200 without any Authorization header', async () => {
    const { status } = await httpGet(port, '/healthz');
    expect(status).toBe(200);
  });

  it('returns 200 even when auth_token is configured', async () => {
    await server.stopServer();

    port = await getFreePort();
    const config: ClusterConfig = {
      node_id: 'test',
      listen_host: '127.0.0.1',
      listen_port: port,
      peers: [],
      auth_token: 'secret',
    };
    server = new ClusterHttpServer(config, makeHandlers());
    await server.startServer();

    const { status } = await httpGet(port, '/healthz');
    expect(status).toBe(200);
  });
});
