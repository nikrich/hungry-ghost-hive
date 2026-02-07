import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { join } from 'path';
import type { Database } from 'sql.js';
import type { ClusterConfig, ClusterPeerConfig } from '../config/schema.js';
import { RaftMetadataStore } from './raft-store.js';
import {
  applyRemoteEvents,
  ensureClusterTables,
  getAllClusterEvents,
  getVersionVector,
  mergeSimilarStories,
  scanLocalChanges,
  type ClusterEvent,
  type VersionVector,
} from './replication.js';

type NodeRole = 'leader' | 'follower' | 'candidate';

interface VoteRequest {
  term: number;
  candidate_id: string;
}

interface VoteResponse {
  term: number;
  vote_granted: boolean;
  leader_id: string | null;
}

interface HeartbeatRequest {
  term: number;
  leader_id: string;
}

interface HeartbeatResponse {
  term: number;
  success: boolean;
}

interface DeltaRequest {
  version_vector: VersionVector;
  limit?: number;
}

interface DeltaResponse {
  events: ClusterEvent[];
  version_vector: VersionVector;
}

interface ClusterRuntimeOptions {
  hiveDir?: string;
}

interface ClusterStatusFetchOptions {
  authToken?: string;
  timeoutMs: number;
}

const MAX_CLUSTER_REQUEST_BODY_BYTES = 1024 * 1024; // 1 MiB

export interface ClusterStatus {
  enabled: boolean;
  node_id: string;
  role: NodeRole;
  term: number;
  voted_for: string | null;
  is_leader: boolean;
  leader_id: string | null;
  leader_url: string | null;
  raft_commit_index: number;
  raft_last_applied: number;
  raft_last_log_index: number;
  peers: Array<{ id: string; url: string }>;
}

export interface ClusterSyncResult {
  local_events_emitted: number;
  imported_events_applied: number;
  merged_duplicate_stories: number;
  durable_log_entries_appended: number;
}

export class ClusterRuntime {
  private server: Server | null = null;
  private electionTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private started = false;

  private role: NodeRole = 'follower';
  private currentTerm = 0;
  private votedFor: string | null = null;
  private leaderId: string | null = null;
  private electionDeadline = 0;
  private electionInFlight = false;

  private eventCache: ClusterEvent[] = [];
  private versionVectorCache: VersionVector = {};
  private raftStore: RaftMetadataStore | null = null;

  constructor(
    private readonly config: ClusterConfig,
    private readonly options: ClusterRuntimeOptions = {}
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled || this.started) return;

    this.validateNetworkSecurity();
    this.initializeRaftStore();
    this.resetElectionDeadline();
    await this.startServer();
    this.startElectionLoop();
    this.startHeartbeatLoop();
    this.started = true;

    this.appendDurableEntry('runtime', {
      event: 'runtime_start',
      node_id: this.config.node_id,
    });
  }

  async stop(): Promise<void> {
    this.appendDurableEntry('runtime', {
      event: 'runtime_stop',
      node_id: this.config.node_id,
    });

    if (this.electionTimer) {
      clearInterval(this.electionTimer);
      this.electionTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.server) {
      await new Promise<void>(resolve => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    this.started = false;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isLeader(): boolean {
    if (!this.config.enabled) return true;
    return this.role === 'leader';
  }

  getStatus(): ClusterStatus {
    const raftState = this.raftStore?.getState();

    return {
      enabled: this.config.enabled,
      node_id: this.config.node_id,
      role: this.role,
      term: this.currentTerm,
      voted_for: this.votedFor,
      is_leader: this.isLeader(),
      leader_id: this.leaderId,
      leader_url: this.getLeaderUrl(),
      raft_commit_index: raftState?.commit_index || 0,
      raft_last_applied: raftState?.last_applied || 0,
      raft_last_log_index: raftState?.last_log_index || 0,
      peers: this.config.peers.map(peer => ({ id: peer.id, url: peer.url })),
    };
  }

  async sync(db: Database): Promise<ClusterSyncResult> {
    if (!this.config.enabled) {
      return {
        local_events_emitted: 0,
        imported_events_applied: 0,
        merged_duplicate_stories: 0,
        durable_log_entries_appended: 0,
      };
    }

    if (!this.raftStore) {
      this.initializeRaftStore();
    }

    ensureClusterTables(db, this.config.node_id);

    const localEventsBefore = scanLocalChanges(db, this.config.node_id);
    const imported = await this.pullEventsFromPeers(db);
    const merged = mergeSimilarStories(db, this.config.story_similarity_threshold);
    const localEventsAfter =
      imported > 0 || merged > 0 ? scanLocalChanges(db, this.config.node_id) : 0;

    this.refreshCache(db);

    const durableLogEntriesAppended = this.appendClusterEventsToDurableLog(getAllClusterEvents(db));

    return {
      local_events_emitted: localEventsBefore + localEventsAfter,
      imported_events_applied: imported,
      merged_duplicate_stories: merged,
      durable_log_entries_appended: durableLogEntriesAppended,
    };
  }

  private initializeRaftStore(): void {
    if (this.raftStore) return;

    const hiveDir = this.options.hiveDir || join(process.cwd(), '.hive');
    const clusterDir = join(hiveDir, 'cluster');

    this.raftStore = new RaftMetadataStore({
      clusterDir,
      nodeId: this.config.node_id,
    });

    const persisted = this.raftStore.getState();
    this.currentTerm = persisted.current_term;
    this.votedFor = persisted.voted_for;
    this.leaderId = persisted.leader_id;
    this.role = 'follower';
  }

  private refreshCache(db: Database): void {
    this.eventCache = getAllClusterEvents(db).slice(-20000);
    this.versionVectorCache = getVersionVector(db);
  }

  private appendClusterEventsToDurableLog(events: ClusterEvent[]): number {
    if (!this.raftStore) return 0;

    const appended = this.raftStore.appendClusterEvents(events, this.currentTerm);
    this.persistRaftState({});
    return appended;
  }

  private async pullEventsFromPeers(db: Database): Promise<number> {
    if (this.config.peers.length === 0) return 0;

    let applied = 0;

    for (const peer of this.config.peers) {
      if (peer.id === this.config.node_id) continue;

      const localVector = getVersionVector(db);
      const response = await this.requestDelta(peer, localVector, 4000);
      if (!response || response.events.length === 0) continue;

      applied += applyRemoteEvents(db, this.config.node_id, response.events);
    }

    return applied;
  }

  private async requestDelta(
    peer: ClusterPeerConfig,
    versionVector: VersionVector,
    limit: number
  ): Promise<DeltaResponse | null> {
    return this.postJson<DeltaResponse>(peer, '/cluster/v1/events/delta', {
      version_vector: versionVector,
      limit,
    });
  }

  private startElectionLoop(): void {
    this.electionTimer = setInterval(() => {
      if (!this.config.enabled) return;
      if (this.role === 'leader') return;

      if (Date.now() >= this.electionDeadline) {
        void this.startElection();
      }
    }, 250);
  }

  private startHeartbeatLoop(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.config.enabled) return;
      if (this.role !== 'leader') return;
      void this.sendHeartbeats();
    }, this.config.heartbeat_interval_ms);
  }

  private async startElection(): Promise<void> {
    if (!this.config.enabled || this.electionInFlight) return;

    this.electionInFlight = true;
    const electionTerm = this.currentTerm + 1;

    this.currentTerm = electionTerm;
    this.role = 'candidate';
    this.votedFor = this.config.node_id;
    this.leaderId = null;
    this.resetElectionDeadline();
    this.persistRaftState({});
    this.appendDurableEntry('election_start', {
      term: electionTerm,
      candidate_id: this.config.node_id,
    });

    let votes = 1;

    try {
      await Promise.all(
        this.config.peers
          .filter(peer => peer.id !== this.config.node_id)
          .map(async peer => {
            const response = await this.postJson<VoteResponse>(
              peer,
              '/cluster/v1/election/request-vote',
              {
                term: electionTerm,
                candidate_id: this.config.node_id,
              } satisfies VoteRequest
            );

            if (!response) return;

            if (response.term > this.currentTerm) {
              this.stepDown(response.term, response.leader_id);
              return;
            }

            if (
              this.role === 'candidate' &&
              this.currentTerm === electionTerm &&
              response.vote_granted
            ) {
              votes += 1;
            }
          })
      );

      if (
        this.role === 'candidate' &&
        this.currentTerm === electionTerm &&
        votes >= this.quorum()
      ) {
        this.role = 'leader';
        this.leaderId = this.config.node_id;
        this.votedFor = null;
        this.persistRaftState({});
        this.appendDurableEntry('election_won', {
          term: electionTerm,
          votes,
          quorum: this.quorum(),
          leader_id: this.config.node_id,
        });
      }
    } finally {
      this.electionInFlight = false;
    }
  }

  private async sendHeartbeats(): Promise<void> {
    const heartbeat: HeartbeatRequest = {
      term: this.currentTerm,
      leader_id: this.config.node_id,
    };

    this.appendDurableEntry('heartbeat_sent', {
      term: this.currentTerm,
      leader_id: this.config.node_id,
      peer_count: this.config.peers.filter(peer => peer.id !== this.config.node_id).length,
    });

    await Promise.all(
      this.config.peers
        .filter(peer => peer.id !== this.config.node_id)
        .map(async peer => {
          const response = await this.postJson<HeartbeatResponse>(
            peer,
            '/cluster/v1/election/heartbeat',
            heartbeat
          );

          if (response && response.term > this.currentTerm) {
            this.stepDown(response.term, peer.id);
          }
        })
    );
  }

  private handleVoteRequest(body: unknown): VoteResponse {
    const request = body as Partial<VoteRequest>;
    const term = Number(request.term || 0);
    const candidateId = typeof request.candidate_id === 'string' ? request.candidate_id : '';

    if (!candidateId) {
      return { term: this.currentTerm, vote_granted: false, leader_id: this.leaderId };
    }

    if (term < this.currentTerm) {
      return { term: this.currentTerm, vote_granted: false, leader_id: this.leaderId };
    }

    if (term > this.currentTerm) {
      this.stepDown(term, null);
    }

    const canVote = this.votedFor === null || this.votedFor === candidateId;
    if (canVote) {
      this.votedFor = candidateId;
      this.resetElectionDeadline();
      this.persistRaftState({});
      this.appendDurableEntry('vote_granted', {
        term: this.currentTerm,
        candidate_id: candidateId,
      });
      return { term: this.currentTerm, vote_granted: true, leader_id: this.leaderId };
    }

    return { term: this.currentTerm, vote_granted: false, leader_id: this.leaderId };
  }

  private handleHeartbeat(body: unknown): HeartbeatResponse {
    const request = body as Partial<HeartbeatRequest>;
    const term = Number(request.term || 0);
    const leaderId = typeof request.leader_id === 'string' ? request.leader_id : null;

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    const changed =
      term > this.currentTerm || leaderId !== this.leaderId || this.role !== 'follower';

    if (term > this.currentTerm) {
      this.stepDown(term, leaderId);
    } else {
      this.role = 'follower';
      this.leaderId = leaderId;
      this.persistRaftState({});
    }

    this.resetElectionDeadline();

    if (changed) {
      this.appendDurableEntry('heartbeat_received', {
        term,
        leader_id: leaderId,
      });
    }

    return { term: this.currentTerm, success: true };
  }

  private stepDown(term: number, leaderId: string | null): void {
    const previousRole = this.role;
    const previousTerm = this.currentTerm;

    this.currentTerm = term;
    this.role = 'follower';
    this.votedFor = null;
    this.leaderId = leaderId;
    this.resetElectionDeadline();
    this.persistRaftState({});

    this.appendDurableEntry('state_transition', {
      previous_role: previousRole,
      previous_term: previousTerm,
      current_term: this.currentTerm,
      leader_id: leaderId,
    });
  }

  private quorum(): number {
    const nodes = this.config.peers.length + 1;
    return Math.floor(nodes / 2) + 1;
  }

  private resetElectionDeadline(): void {
    const min = this.config.election_timeout_min_ms;
    const max = Math.max(min, this.config.election_timeout_max_ms);
    const spread = max - min;
    const jitter = spread === 0 ? 0 : Math.floor(Math.random() * spread);
    this.electionDeadline = Date.now() + min + jitter;
  }

  private persistRaftState(_patch: Partial<Record<string, unknown>>): void {
    if (!this.raftStore) return;

    this.raftStore.setState({
      current_term: this.currentTerm,
      voted_for: this.votedFor,
      leader_id: this.leaderId,
    });
  }

  private appendDurableEntry(
    type: Parameters<RaftMetadataStore['appendEntry']>[0]['type'],
    metadata: Record<string, unknown>
  ): void {
    if (!this.raftStore) return;
    this.raftStore.appendEntry({ type, term: this.currentTerm, metadata });
  }

  private validateNetworkSecurity(): void {
    if (isLoopbackHost(this.config.listen_host)) return;
    if (this.config.auth_token) return;

    throw new Error(
      `Cluster auth_token is required when listen_host is not loopback (received: ${this.config.listen_host})`
    );
  }

  private async startServer(): Promise<void> {
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

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.authorize(req)) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }

      const method = req.method || 'GET';
      const path = req.url?.split('?')[0] || '/';

      if (method === 'GET' && path === '/cluster/v1/status') {
        sendJson(res, 200, this.getStatus());
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/election/request-vote') {
        const body = await readJsonBody(req);
        const response = this.handleVoteRequest(body);
        sendJson(res, 200, response);
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/election/heartbeat') {
        const body = await readJsonBody(req);
        const response = this.handleHeartbeat(body);
        sendJson(res, 200, response);
        return;
      }

      if (method === 'POST' && path === '/cluster/v1/events/delta') {
        const body = (await readJsonBody(req)) as Partial<DeltaRequest>;
        const vector = toVersionVector(body.version_vector);
        const limit =
          typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0
            ? Math.floor(body.limit)
            : 2000;

        const events = this.getDeltaFromCache(vector, limit);
        sendJson(res, 200, {
          events,
          version_vector: this.versionVectorCache,
        } satisfies DeltaResponse);
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

  private getDeltaFromCache(remoteVersionVector: VersionVector, limit: number): ClusterEvent[] {
    return this.eventCache
      .filter(event => {
        const known = remoteVersionVector[event.version.actor_id] || 0;
        return event.version.actor_counter > known;
      })
      .slice(0, limit);
  }

  private authorize(req: IncomingMessage): boolean {
    if (!this.config.auth_token) return true;

    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    const expected = `Bearer ${this.config.auth_token}`;
    return authHeader === expected;
  }

  private async postJson<T>(
    peer: ClusterPeerConfig,
    path: string,
    body: unknown
  ): Promise<T | null> {
    const normalizedBase = peer.url.endsWith('/') ? peer.url : `${peer.url}/`;
    const url = new URL(path.replace(/^\//, ''), normalizedBase).toString();

    return fetchClusterStatusOrPostJson<T>(
      url,
      this.config.request_timeout_ms,
      this.config.auth_token,
      {
        method: 'POST',
        body,
      }
    );
  }

  private getLeaderUrl(): string | null {
    if (!this.leaderId) return null;
    if (this.leaderId === this.config.node_id) return this.config.public_url;

    const peer = this.config.peers.find(item => item.id === this.leaderId);
    return peer?.url || null;
  }
}

export async function fetchLocalClusterStatus(
  config: ClusterConfig
): Promise<ClusterStatus | null> {
  if (!config.enabled) {
    return {
      enabled: false,
      node_id: config.node_id,
      role: 'leader',
      term: 0,
      voted_for: null,
      is_leader: true,
      leader_id: config.node_id,
      leader_url: null,
      raft_commit_index: 0,
      raft_last_applied: 0,
      raft_last_log_index: 0,
      peers: config.peers.map(peer => ({ id: peer.id, url: peer.url })),
    };
  }

  const host = config.listen_host === '0.0.0.0' ? '127.0.0.1' : config.listen_host;
  const url = `http://${host}:${config.listen_port}/cluster/v1/status`;

  return fetchClusterStatusFromUrl(url, {
    authToken: config.auth_token,
    timeoutMs: config.request_timeout_ms,
  });
}

export async function fetchClusterStatusFromUrl(
  url: string,
  options: ClusterStatusFetchOptions
): Promise<ClusterStatus | null> {
  const response = await fetchClusterStatusOrPostJson<unknown>(
    url,
    options.timeoutMs,
    options.authToken,
    {
      method: 'GET',
    }
  );

  if (!response || typeof response !== 'object') return null;

  return parseClusterStatus(response as Record<string, unknown>);
}

function parseClusterStatus(input: Record<string, unknown>): ClusterStatus {
  const role: NodeRole =
    input.role === 'leader' || input.role === 'candidate' || input.role === 'follower'
      ? input.role
      : 'follower';

  const peers = Array.isArray(input.peers)
    ? input.peers
        .map(peer => {
          if (!peer || typeof peer !== 'object') return null;
          const item = peer as { id?: unknown; url?: unknown };
          return typeof item.id === 'string' && typeof item.url === 'string'
            ? { id: item.id, url: item.url }
            : null;
        })
        .filter((peer): peer is { id: string; url: string } => peer !== null)
    : [];

  return {
    enabled: input.enabled !== false,
    node_id: typeof input.node_id === 'string' ? input.node_id : 'unknown',
    role,
    term: toInt(input.term),
    voted_for: typeof input.voted_for === 'string' ? input.voted_for : null,
    is_leader: input.is_leader === true,
    leader_id: typeof input.leader_id === 'string' ? input.leader_id : null,
    leader_url: typeof input.leader_url === 'string' ? input.leader_url : null,
    raft_commit_index: toInt(input.raft_commit_index),
    raft_last_applied: toInt(input.raft_last_applied),
    raft_last_log_index: toInt(input.raft_last_log_index),
    peers,
  };
}

async function fetchClusterStatusOrPostJson<T>(
  url: string,
  timeoutMs: number,
  authToken: string | undefined,
  options: {
    method: 'GET' | 'POST';
    body?: unknown;
  }
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.method === 'POST' ? JSON.stringify(options.body || {}) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

function toInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}
