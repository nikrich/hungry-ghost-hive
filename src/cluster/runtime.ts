// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
import type { ClusterConfig, ClusterPeerConfig } from '../config/schema.js';
import { ClusterHttpServer } from './cluster-http-server.js';
import { HeartbeatManager } from './heartbeat-manager.js';
import { RaftStateMachine } from './raft-state-machine.js';
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

interface ClusterRuntimeOptions {
  hiveDir?: string;
}

interface ClusterStatusFetchOptions {
  authToken?: string;
  timeoutMs: number;
}

interface DeltaResponse {
  events: ClusterEvent[];
  version_vector: VersionVector;
}

export interface PeerReplicationMetrics {
  peer_id: string;
  events_behind: number;
  last_sync_at: string | null;
  last_sync_latency_ms: number | null;
  last_sync_events_applied: number;
  reachable: boolean;
}

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
  replication: {
    peer_metrics: PeerReplicationMetrics[];
    local_event_count: number;
    last_sync_at: string | null;
  };
}

export interface ClusterSyncResult {
  local_events_emitted: number;
  imported_events_applied: number;
  merged_duplicate_stories: number;
  durable_log_entries_appended: number;
}

export class ClusterRuntime {
  private started = false;
  private stopping = false;

  private eventCache: ClusterEvent[] = [];
  private versionVectorCache: VersionVector = {};
  private peerMetrics: Map<string, PeerReplicationMetrics> = new Map();
  private lastSyncAt: string | null = null;
  private localEventCount = 0;

  private readonly raft: RaftStateMachine;
  private readonly heartbeat: HeartbeatManager;
  private readonly httpServer: ClusterHttpServer;

  constructor(
    private readonly config: ClusterConfig,
    private readonly options: ClusterRuntimeOptions = {}
  ) {
    this.raft = new RaftStateMachine(config, {
      postJson: (peer, path, body) => this.postJson(peer, path, body),
      isActive: () => this.started && !this.stopping,
      handleBackgroundError: error => this.handleBackgroundError(error),
    });

    this.heartbeat = new HeartbeatManager(config, {
      raft: this.raft,
      postJson: (peer, path, body) => this.postJson(peer, path, body),
      isActive: () => this.started && !this.stopping,
      handleBackgroundError: error => this.handleBackgroundError(error),
    });

    this.httpServer = new ClusterHttpServer(config, {
      getStatus: () => this.getStatus(),
      handleVoteRequest: body => this.raft.handleVoteRequest(body),
      handleHeartbeat: body => this.heartbeat.handleHeartbeat(body),
      getDeltaFromCache: (vector, limit) => this.getDeltaFromCache(vector, limit),
      getVersionVectorCache: () => this.versionVectorCache,
    });
  }

  async start(): Promise<void> {
    if (!this.config.enabled || this.started) return;

    this.stopping = false;
    this.validateNetworkSecurity();

    const hiveDir = this.options.hiveDir || join(process.cwd(), '.hive');
    this.raft.initializeRaftStore(hiveDir);

    await this.httpServer.startServer();
    this.raft.startElectionLoop();
    this.heartbeat.startHeartbeatLoop();
    this.started = true;

    this.raft.appendDurableEntry('runtime', {
      event: 'runtime_start',
      node_id: this.config.node_id,
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;

    this.raft.stopElectionLoop();
    this.heartbeat.stopHeartbeatLoop();

    this.raft.appendDurableEntry('runtime', {
      event: 'runtime_stop',
      node_id: this.config.node_id,
    });

    await this.httpServer.stopServer();

    this.started = false;
    this.raft.clearRaftStore();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isLeader(): boolean {
    if (!this.config.enabled) return true;
    return this.raft.role === 'leader';
  }

  getStatus(): ClusterStatus {
    const raftState = this.raft.getRaftStoreState();

    const peerMetricsList: PeerReplicationMetrics[] = [];
    for (const peer of this.config.peers) {
      if (peer.id === this.config.node_id) continue;
      const metrics = this.peerMetrics.get(peer.id);
      peerMetricsList.push(
        metrics || {
          peer_id: peer.id,
          events_behind: 0,
          last_sync_at: null,
          last_sync_latency_ms: null,
          last_sync_events_applied: 0,
          reachable: false,
        }
      );
    }

    return {
      enabled: this.config.enabled,
      node_id: this.config.node_id,
      role: this.raft.role,
      term: this.raft.currentTerm,
      voted_for: this.raft.votedFor,
      is_leader: this.isLeader(),
      leader_id: this.raft.leaderId,
      leader_url: this.raft.getLeaderUrl(),
      raft_commit_index: raftState?.commit_index || 0,
      raft_last_applied: raftState?.last_applied || 0,
      raft_last_log_index: raftState?.last_log_index || 0,
      peers: this.config.peers.map(peer => ({ id: peer.id, url: peer.url })),
      replication: {
        peer_metrics: peerMetricsList,
        local_event_count: this.localEventCount,
        last_sync_at: this.lastSyncAt,
      },
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

    const hiveDir = this.options.hiveDir || join(process.cwd(), '.hive');
    this.raft.initializeRaftStore(hiveDir);

    ensureClusterTables(db, this.config.node_id);

    const localEventsBefore = scanLocalChanges(db, this.config.node_id);
    const imported = await this.pullEventsFromPeers(db);
    const merged = mergeSimilarStories(db, this.config.story_similarity_threshold);
    const localEventsAfter =
      imported > 0 || merged > 0 ? scanLocalChanges(db, this.config.node_id) : 0;

    this.refreshCache(db);

    const durableLogEntriesAppended = this.raft.appendClusterEventsToDurableLog(
      getAllClusterEvents(db)
    );

    const result: ClusterSyncResult = {
      local_events_emitted: localEventsBefore + localEventsAfter,
      imported_events_applied: imported,
      merged_duplicate_stories: merged,
      durable_log_entries_appended: durableLogEntriesAppended,
    };

    if (result.imported_events_applied > 0 || result.local_events_emitted > 0) {
      logClusterEvent('sync_cycle_complete', {
        node_id: this.config.node_id,
        role: this.raft.role,
        ...result,
      });
    }

    return result;
  }

  private refreshCache(db: Database): void {
    const allEvents = getAllClusterEvents(db);
    this.eventCache = allEvents.slice(-20000);
    this.versionVectorCache = getVersionVector(db);
    this.localEventCount = allEvents.length;
  }

  private async pullEventsFromPeers(db: Database): Promise<number> {
    if (this.config.peers.length === 0) return 0;

    let applied = 0;
    const syncTimestamp = new Date().toISOString();

    for (const peer of this.config.peers) {
      if (peer.id === this.config.node_id) continue;

      const localVector = getVersionVector(db);
      const startMs = Date.now();
      const response = await this.requestDelta(peer, localVector, 4000);
      const latencyMs = Date.now() - startMs;

      if (!response) {
        this.peerMetrics.set(peer.id, {
          peer_id: peer.id,
          events_behind: this.peerMetrics.get(peer.id)?.events_behind ?? 0,
          last_sync_at: syncTimestamp,
          last_sync_latency_ms: latencyMs,
          last_sync_events_applied: 0,
          reachable: false,
        });
        logClusterEvent('sync_peer_unreachable', { peer_id: peer.id, latency_ms: latencyMs });
        continue;
      }

      const peerEventsApplied =
        response.events.length > 0
          ? applyRemoteEvents(db, this.config.node_id, response.events)
          : 0;
      applied += peerEventsApplied;

      const eventsBehind = computeEventsBehind(localVector, response.version_vector);

      this.peerMetrics.set(peer.id, {
        peer_id: peer.id,
        events_behind: eventsBehind,
        last_sync_at: syncTimestamp,
        last_sync_latency_ms: latencyMs,
        last_sync_events_applied: peerEventsApplied,
        reachable: true,
      });

      if (peerEventsApplied > 0 || eventsBehind > 0) {
        logClusterEvent('sync_peer_complete', {
          peer_id: peer.id,
          events_applied: peerEventsApplied,
          events_behind: eventsBehind,
          latency_ms: latencyMs,
        });
      }
    }

    this.lastSyncAt = syncTimestamp;
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

  private getDeltaFromCache(remoteVersionVector: VersionVector, limit: number): ClusterEvent[] {
    return this.eventCache
      .filter(event => {
        const known = remoteVersionVector[event.version.actor_id] || 0;
        return event.version.actor_counter > known;
      })
      .slice(0, limit);
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

  private handleBackgroundError(error: unknown): void {
    if (!this.started || this.stopping) return;
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return;
    console.error('Cluster runtime background task failed:', error);
  }

  private validateNetworkSecurity(): void {
    if (isLoopbackHost(this.config.listen_host)) return;
    if (this.config.auth_token) return;

    throw new Error(
      `Cluster auth_token is required when listen_host is not loopback (received: ${this.config.listen_host})`
    );
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
      replication: {
        peer_metrics: [],
        local_event_count: 0,
        last_sync_at: null,
      },
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

  const replicationInput =
    input.replication && typeof input.replication === 'object'
      ? (input.replication as Record<string, unknown>)
      : null;

  const peerMetrics: PeerReplicationMetrics[] = [];
  if (replicationInput && Array.isArray(replicationInput.peer_metrics)) {
    for (const item of replicationInput.peer_metrics) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      peerMetrics.push({
        peer_id: typeof m.peer_id === 'string' ? m.peer_id : 'unknown',
        events_behind: toInt(m.events_behind),
        last_sync_at: typeof m.last_sync_at === 'string' ? m.last_sync_at : null,
        last_sync_latency_ms:
          typeof m.last_sync_latency_ms === 'number' ? m.last_sync_latency_ms : null,
        last_sync_events_applied: toInt(m.last_sync_events_applied),
        reachable: m.reachable === true,
      });
    }
  }

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
    replication: {
      peer_metrics: peerMetrics,
      local_event_count: toInt(replicationInput?.local_event_count),
      last_sync_at:
        typeof replicationInput?.last_sync_at === 'string' ? replicationInput.last_sync_at : null,
    },
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

function computeEventsBehind(
  localVector: VersionVector,
  remoteVector: VersionVector
): number {
  let behind = 0;
  for (const [actorId, remoteCounter] of Object.entries(remoteVector)) {
    const localCounter = localVector[actorId] || 0;
    if (remoteCounter > localCounter) {
      behind += remoteCounter - localCounter;
    }
  }
  return behind;
}

export function logClusterEvent(
  event: string,
  data: Record<string, unknown>
): void {
  const entry = {
    ts: new Date().toISOString(),
    component: 'cluster',
    event,
    ...data,
  };
  console.log(JSON.stringify(entry));
}
