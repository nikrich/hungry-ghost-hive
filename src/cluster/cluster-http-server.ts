// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { ClusterConfig } from '../config/schema.js';
import type { ClusterEvent, VersionVector } from './replication.js';

interface DeltaRequest {
  version_vector: VersionVector;
  limit?: number;
  fencing_token?: number;
}

interface DeltaResponse {
  events: ClusterEvent[];
  version_vector: VersionVector;
  fencing_token: number;
}

const MAX_CLUSTER_REQUEST_BODY_BYTES = 1024 * 1024; // 1 MiB

export interface MembershipJoinRequest {
  node_id: string;
  url: string;
}

export interface MembershipJoinResponse {
  success: boolean;
  leader_id: string | null;
  leader_url: string | null;
  peers: Array<{ id: string; url: string }>;
  term: number;
}

export interface MembershipLeaveRequest {
  node_id: string;
}

export interface MembershipLeaveResponse {
  success: boolean;
  peers: Array<{ id: string; url: string }>;
}

export interface ClusterHttpHandlers {
  getStatus: () => unknown;
  handleVoteRequest: (body: unknown) => unknown;
  handleHeartbeat: (body: unknown) => unknown;
  getDeltaFromCache: (vector: VersionVector, limit: number) => ClusterEvent[];
  getVersionVectorCache: () => VersionVector;
  getReplicationLag: () => unknown;
  getFencingToken: () => number;
  validateFencingToken: (token: number) => boolean;
  isLeaderLeaseValid: () => boolean;
  handleMembershipJoin: (body: MembershipJoinRequest) => MembershipJoinResponse;
  handleMembershipLeave: (body: MembershipLeaveRequest) => MembershipLeaveResponse;
  /** Returns a full snapshot of all replicated tables for state recovery. */
  getSnapshot: () => unknown;
}

export class ClusterHttpServer {
  private server: Server | null = null;

  constructor(
    private readonly config: ClusterConfig,
    private readonly handlers: ClusterHttpHandlers
  ) {}

  async startServer(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.server) return reject(new Error('Cluster HTTP server not initialized'));

      this.server.once('error', reject);
      this.server.listen(this.config.listen_port, this.config.listen_host, () => {
        this.server?.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stopServer(): Promise<void> {
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.authorize(req)) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const method = req.method || 'GET';
      const path = req.url?.split('?')[0] || '/';

      if (method === 'GET' && path === '/cluster/v1/status') {
        sendJson(res, 200, this.handlers.getStatus());
        return;
      }

      if (method === 'GET' && path === '/cluster/v1/snapshot') {
        sendJson(res, 200, this.handlers.getSnapshot());
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/election/request-vote') {
        const body = await readJsonBody(req);
        const response = this.handlers.handleVoteRequest(body);
        sendJson(res, 200, response);
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/election/heartbeat') {
        const body = await readJsonBody(req);
        const response = this.handlers.handleHeartbeat(body);
        sendJson(res, 200, response);
        return;
      }

      if (method === 'GET' && path === '/cluster/v1/replication-lag') {
        sendJson(res, 200, this.handlers.getReplicationLag());
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/events/delta') {
        const body = (await readJsonBody(req)) as Partial<DeltaRequest>;

        // Validate fencing token if provided — reject stale-leader requests
        if (typeof body.fencing_token === 'number') {
          if (!this.handlers.validateFencingToken(body.fencing_token)) {
            sendJson(res, 409, {
              error: 'Fencing token rejected: stale leader epoch',
              fencing_token: this.handlers.getFencingToken(),
            });
            return;
          }
        }

        const vector = toVersionVector(body.version_vector);
        const limit =
          typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0
            ? Math.floor(body.limit)
            : 2000;

        const events = this.handlers.getDeltaFromCache(vector, limit);
        sendJson(res, 200, {
          events,
          version_vector: this.handlers.getVersionVectorCache(),
          fencing_token: this.handlers.getFencingToken(),
        } satisfies DeltaResponse);
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/membership/join') {
        const body = (await readJsonBody(req)) as Partial<MembershipJoinRequest>;
        if (typeof body.node_id !== 'string' || typeof body.url !== 'string') {
          sendJson(res, 400, { error: 'node_id and url are required' });
          return;
        }
        const response = this.handlers.handleMembershipJoin({
          node_id: body.node_id,
          url: body.url,
        });
        sendJson(res, response.success ? 200 : 307, response);
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/membership/leave') {
        const body = (await readJsonBody(req)) as Partial<MembershipLeaveRequest>;
        if (typeof body.node_id !== 'string') {
          sendJson(res, 400, { error: 'node_id is required' });
          return;
        }
        const response = this.handlers.handleMembershipLeave({ node_id: body.node_id });
        sendJson(res, response.success ? 200 : 400, response);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error instanceof HttpRequestError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  }

  private authorize(req: IncomingMessage): boolean {
    if (!this.config.auth_token) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    const expected = `Bearer ${this.config.auth_token}`;
    return authHeader === expected;
  }
}

class HttpRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = MAX_CLUSTER_REQUEST_BODY_BYTES
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += normalizedChunk.length;

    if (totalBytes > maxBytes) {
      throw new HttpRequestError(413, `Payload too large (max ${maxBytes} bytes)`);
    }

    chunks.push(normalizedChunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpRequestError(400, 'Invalid JSON payload');
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function toVersionVector(input: unknown): VersionVector {
  if (!input || typeof input !== 'object') return {};

  const vector: VersionVector = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num) && num >= 0) {
      vector[key] = Math.floor(num);
    }
  }

  return vector;
}
