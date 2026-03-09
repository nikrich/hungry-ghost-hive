// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
import type { ClusterConfig, ClusterPeerConfig } from '../config/schema.js';
import { queryAll } from '../db/client.js';
import { REPLICATED_TABLES } from './adapters.js';
import {
  ClusterHttpServer,
  type MembershipJoinRequest,
  type MembershipJoinResponse,
  type MembershipLeaveRequest,
  type MembershipLeaveResponse,
} from './cluster-http-server.js';
import { HeartbeatManager } from './heartbeat-manager.js';
import { RaftStateMachine } from './raft-state-machine.js';
import {
  applyRemoteEvents,
  ensureClusterTables,
  getAllClusterEvents,
  getClusterEventCount,
  getEffectiveVersionVector,
  getVersionVector,
  mergeSimilarStories,
  pruneClusterEvents,
  scanLocalChanges,
  setSnapshotVersionVector,
  type ClusterEvent,
  type VersionVector,
} from './replication.js';
import type { ClusterSnapshot } from './types.js';

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
  fencing_token?: number;
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
  fencing_token: number;
  leader_lease_valid: boolean;
  leader_lease_duration_ms: number;
  raft_commit_index: number;
  raft_last_applied: number;
  raft_last_log_index: number;
  peers: Array<{ id: string; url: string }>;
  /** True while the node is performing snapshot-based catch-up and not yet election-eligible. */
  is_catching_up: boolean;
}

export interface ClusterSyncResult {
  local_events_emitted: number;
  imported_events_applied: number;
  merged_duplicate_stories: number;
  durable_log_entries_appended: number;
  log_entries_compacted: number;
  cluster_events_pruned: number;
  /** True when this sync triggered snapshot-based recovery rather than delta sync. */
  used_snapshot_recovery: boolean;
  /** Number of rows applied from the snapshot (0 when delta sync was used). */
  catch_up_applied: number;
  /** Total rows in the snapshot (0 when delta sync was used). */
  catch_up_total: number;
}

export interface PeerReplicationLag {
  peer_id: string;
  peer_url: string;
  reachable: boolean;
  events_behind: number;
  last_sync_at: string | null;
  last_sync_duration_ms: number | null;
  last_sync_events_applied: number;
}

export interface ReplicationLagSummary {
  node_id: string;
  total_local_events: number;
  version_vector: VersionVector;
  peers: PeerReplicationLag[];
  last_sync_at: string | null;
}

export class ClusterRuntime {
  private started = false;
  private stopping = false;

  private eventCache: ClusterEvent[] = [];
  private versionVectorCache: VersionVector = {};
  private lastCompactionAt = 0;
  private peerLagMap = new Map<string, PeerReplicationLag>();
  private lastSyncAt: string | null = null;

  /** Cached full snapshot refreshed on every sync, served to recovering nodes. */
  private cachedSnapshot: ClusterSnapshot | null = null;

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
      onPeersUpdated: peers => {
        // Follower received updated peer list from leader via heartbeat
        this.raft.setPeers(peers);
      },
    });

    this.httpServer = new ClusterHttpServer(config, {
      getStatus: () => this.getStatus(),
      handleVoteRequest: body => this.raft.handleVoteRequest(body),
      handleHeartbeat: body => this.heartbeat.handleHeartbeat(body),
      getDeltaFromCache: (vector, limit) => this.getDeltaFromCache(vector, limit),
      getVersionVectorCache: () => this.versionVectorCache,
      getReplicationLag: () => this.getReplicationLag(),
      getFencingToken: () => this.raft.getFencingToken(),
      validateFencingToken: token => this.raft.validateFencingToken(token),
      isLeaderLeaseValid: () => this.raft.isLeaderLeaseValid(),
      handleMembershipJoin: body => this.handleMembershipJoin(body),
      handleMembershipLeave: body => this.handleMembershipLeave(body),
      getSnapshot: () => this.cachedSnapshot ?? { version_vector: {}, tables: {} },
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

  getReplicationLag(): ReplicationLagSummary {
    return {
      node_id: this.config.node_id,
      total_local_events: this.eventCache.length,
      version_vector: { ...this.versionVectorCache },
      peers: this.raft
        .getPeers()
        .filter(p => p.id !== this.config.node_id)
        .map(
          p =>
            this.peerLagMap.get(p.id) || {
              peer_id: p.id,
              peer_url: p.url,
              reachable: false,
              events_behind: 0,
              last_sync_at: null,
              last_sync_duration_ms: null,
              last_sync_events_applied: 0,
            }
        ),
      last_sync_at: this.lastSyncAt,
    };
  }

  getStatus(): ClusterStatus {
    const raftState = this.raft.getRaftStoreState();

    return {
      enabled: this.config.enabled,
      node_id: this.config.node_id,
      role: this.raft.role,
      term: this.raft.currentTerm,
      voted_for: this.raft.votedFor,
      is_leader: this.isLeader(),
      leader_id: this.raft.leaderId,
      leader_url: this.raft.getLeaderUrl(),
      fencing_token: this.raft.getFencingToken(),
      leader_lease_valid: this.raft.isLeaderLeaseValid(),
      leader_lease_duration_ms: this.raft.leaderLeaseDurationMs,
      raft_commit_index: raftState?.commit_index || 0,
      raft_last_applied: raftState?.last_applied || 0,
      raft_last_log_index: raftState?.last_log_index || 0,
      peers: this.raft.getPeers().map(peer => ({ id: peer.id, url: peer.url })),
      is_catching_up: this.raft.isCatchingUp,
    };
  }

  async sync(db: Database): Promise<ClusterSyncResult> {
    if (!this.config.enabled) {
      return {
        local_events_emitted: 0,
        imported_events_applied: 0,
        merged_duplicate_stories: 0,
        durable_log_entries_appended: 0,
        log_entries_compacted: 0,
        cluster_events_pruned: 0,
        used_snapshot_recovery: false,
        catch_up_applied: 0,
        catch_up_total: 0,
      };
    }

    const hiveDir = this.options.hiveDir || join(process.cwd(), '.hive');
    this.raft.initializeRaftStore(hiveDir);

    ensureClusterTables(db, this.config.node_id);

    // Refresh snapshot cache so the HTTP endpoint always serves current data
    this.cachedSnapshot = this.buildSnapshot(db);

    const localEventsBefore = scanLocalChanges(db, this.config.node_id);
    const { imported, usedSnapshot, catchUpApplied, catchUpTotal } =
      await this.pullEventsFromPeers(db);
    const merged = mergeSimilarStories(db, this.config.story_similarity_threshold);
    const localEventsAfter =
      imported > 0 || merged > 0 || usedSnapshot ? scanLocalChanges(db, this.config.node_id) : 0;

    this.refreshCache(db);

    const durableLogEntriesAppended = this.raft.appendClusterEventsToDurableLog(
      getAllClusterEvents(db)
    );

    // Run compaction if thresholds are met and enough time has elapsed
    const { logCompacted, eventsPruned } = this.maybeCompact(db);

    return {
      local_events_emitted: localEventsBefore + localEventsAfter,
      imported_events_applied: imported,
      merged_duplicate_stories: merged,
      durable_log_entries_appended: durableLogEntriesAppended,
      log_entries_compacted: logCompacted,
      cluster_events_pruned: eventsPruned,
      used_snapshot_recovery: usedSnapshot,
      catch_up_applied: catchUpApplied,
      catch_up_total: catchUpTotal,
    };
  }

  handleMembershipJoin(request: MembershipJoinRequest): MembershipJoinResponse {
    const peers = this.raft.getPeers();
    const leaderUrl = this.raft.getLeaderUrl();

    // If not the leader, redirect to leader
    if (this.raft.role !== 'leader') {
      return {
        success: false,
        leader_id: this.raft.leaderId,
        leader_url: leaderUrl,
        peers: peers.map(p => ({ id: p.id, url: p.url })),
        term: this.raft.currentTerm,
      };
    }

    // Check if peer already exists
    const existing = peers.find(p => p.id === request.node_id);
    if (existing) {
      // Update URL if changed
      if (existing.url !== request.url) {
        const updated = peers.map(p =>
          p.id === request.node_id ? { id: p.id, url: request.url } : p
        );
        this.raft.setPeers(updated);
        this.raft.appendDurableEntry('membership_change', {
          action: 'update',
          node_id: request.node_id,
          url: request.url,
          peer_count: updated.length,
        });
      }
      return {
        success: true,
        leader_id: this.raft.leaderId,
        leader_url: this.config.public_url,
        peers: this.raft.getPeers().map(p => ({ id: p.id, url: p.url })),
        term: this.raft.currentTerm,
      };
    }

    // Add new peer
    const newPeer: ClusterPeerConfig = { id: request.node_id, url: request.url };
    const updated = [...peers, newPeer];
    this.raft.setPeers(updated);

    this.raft.appendDurableEntry('membership_change', {
      action: 'join',
      node_id: request.node_id,
      url: request.url,
      peer_count: updated.length,
    });

    return {
      success: true,
      leader_id: this.raft.leaderId,
      leader_url: this.config.public_url,
      peers: updated.map(p => ({ id: p.id, url: p.url })),
      term: this.raft.currentTerm,
    };
  }

  handleMembershipLeave(request: MembershipLeaveRequest): MembershipLeaveResponse {
    const peers = this.raft.getPeers();

    // If not the leader, cannot process leave
    if (this.raft.role !== 'leader') {
      return {
        success: false,
        peers: peers.map(p => ({ id: p.id, url: p.url })),
      };
    }

    // Cannot remove self (leader) — leader must transfer leadership first
    if (request.node_id === this.config.node_id) {
      return {
        success: false,
        peers: peers.map(p => ({ id: p.id, url: p.url })),
      };
    }

    const existing = peers.find(p => p.id === request.node_id);
    if (!existing) {
      // Already gone
      return {
        success: true,
        peers: peers.map(p => ({ id: p.id, url: p.url })),
      };
    }

    const updated = peers.filter(p => p.id !== request.node_id);
    this.raft.setPeers(updated);

    this.raft.appendDurableEntry('membership_change', {
      action: 'leave',
      node_id: request.node_id,
      peer_count: updated.length,
    });

    return {
      success: true,
      peers: updated.map(p => ({ id: p.id, url: p.url })),
    };
  }

  private maybeCompact(db: Database): { logCompacted: number; eventsPruned: number } {
    const now = Date.now();
    const interval = this.config.compaction_interval_ms ?? 300000;

    // Respect minimum interval between compaction runs
    if (interval > 0 && now - this.lastCompactionAt < interval) {
      return { logCompacted: 0, eventsPruned: 0 };
    }

    let logCompacted = 0;
    let eventsPruned = 0;

    // Compact raft log if threshold exceeded
    const maxLogEntries = this.config.max_log_entries ?? 10000;
    if (maxLogEntries > 0) {
      const logCount = this.raft.getLogEntryCount();
      if (logCount > maxLogEntries) {
        const versionVector = getVersionVector(db);
        const result = this.raft.createSnapshotAndCompact(versionVector);
        logCompacted = result.entries_removed;
      }
    }

    // Prune cluster_events if threshold exceeded
    const maxEvents = this.config.max_cluster_events ?? 50000;
    if (maxEvents > 0) {
      const eventCount = getClusterEventCount(db);
      if (eventCount > maxEvents) {
        eventsPruned = pruneClusterEvents(db, maxEvents);
        if (eventsPruned > 0) {
          this.refreshCache(db);
        }
      }
    }

    if (logCompacted > 0 || eventsPruned > 0) {
      this.lastCompactionAt = now;
    }

    return { logCompacted, eventsPruned };
  }

  private refreshCache(db: Database): void {
    this.eventCache = getAllClusterEvents(db).slice(-20000);
    this.versionVectorCache = getVersionVector(db);
  }

  private async pullEventsFromPeers(db: Database): Promise<{
    imported: number;
    usedSnapshot: boolean;
    catchUpApplied: number;
    catchUpTotal: number;
  }> {
    const peers = this.raft.getPeers();
    if (peers.length === 0) {
      return { imported: 0, usedSnapshot: false, catchUpApplied: 0, catchUpTotal: 0 };
    }

    let imported = 0;
    const syncTimestamp = new Date().toISOString();
    this.lastSyncAt = syncTimestamp;

    for (const peer of peers) {
      if (peer.id === this.config.node_id) continue;

      const localVector = getEffectiveVersionVector(db);
      const syncStart = Date.now();
      const response = await this.requestDelta(peer, localVector, 4000);

      if (!response) {
        this.peerLagMap.set(peer.id, {
          peer_id: peer.id,
          peer_url: peer.url,
          reachable: false,
          events_behind: 0,
          last_sync_at: syncTimestamp,
          last_sync_duration_ms: Date.now() - syncStart,
          last_sync_events_applied: 0,
        });
        continue;
      }

      // If the peer advertises a higher fencing token, step down
      if (
        typeof response.fencing_token === 'number' &&
        response.fencing_token > this.raft.currentTerm
      ) {
        this.raft.stepDown(response.fencing_token, null);
      }

      // Detect if the delta is insufficient (peer's log was truncated past our position)
      if (this.isDeltaInsufficient(localVector, response.version_vector, response.events)) {
        const recovery = await this.recoverFromSnapshot(db, peer);
        if (recovery !== null) {
          this.peerLagMap.set(peer.id, {
            peer_id: peer.id,
            peer_url: peer.url,
            reachable: true,
            events_behind: 0,
            last_sync_at: syncTimestamp,
            last_sync_duration_ms: Date.now() - syncStart,
            last_sync_events_applied: recovery.applied,
          });
          return {
            imported: 0,
            usedSnapshot: true,
            catchUpApplied: recovery.applied,
            catchUpTotal: recovery.total,
          };
        }
        // Snapshot recovery failed — fall through and apply whatever delta we have
      }

      const eventsBehind = response.events.length;
      const peerApplied =
        eventsBehind > 0 ? applyRemoteEvents(db, this.config.node_id, response.events) : 0;
      imported += peerApplied;

      this.peerLagMap.set(peer.id, {
        peer_id: peer.id,
        peer_url: peer.url,
        reachable: true,
        events_behind: eventsBehind,
        last_sync_at: syncTimestamp,
        last_sync_duration_ms: Date.now() - syncStart,
        last_sync_events_applied: peerApplied,
      });
    }

    // If we had been catching up and now the effective vector matches peers, mark done
    if (this.raft.isCatchingUp) {
      this.raft.isCatchingUp = false;
    }

    return { imported, usedSnapshot: false, catchUpApplied: 0, catchUpTotal: 0 };
  }

  /**
   * Returns true when the delta response is missing events the peer should have.
   * This happens when the peer's event cache has been truncated (log compaction)
   * and can no longer provide all events since our last known version.
   */
  private isDeltaInsufficient(
    localVector: VersionVector,
    peerVector: VersionVector,
    receivedEvents: ClusterEvent[]
  ): boolean {
    // Count how many events we actually received per actor
    const received: Record<string, number> = {};
    for (const event of receivedEvents) {
      received[event.version.actor_id] = (received[event.version.actor_id] ?? 0) + 1;
    }

    for (const [actorId, peerCounter] of Object.entries(peerVector)) {
      const localCounter = localVector[actorId] ?? 0;
      const needed = peerCounter - localCounter;
      if (needed <= 0) continue;

      const receivedCount = received[actorId] ?? 0;
      if (receivedCount < needed) {
        // We're missing events for this actor that the peer should have
        return true;
      }
    }

    return false;
  }

  /**
   * Requests a full snapshot from the given peer and applies it locally.
   * Marks the node as no longer catching up once complete.
   * Returns { applied, total } on success, null on failure.
   */
  private async recoverFromSnapshot(
    db: Database,
    peer: ClusterPeerConfig
  ): Promise<{ applied: number; total: number } | null> {
    this.raft.isCatchingUp = true;
    this.raft.appendDurableEntry('runtime', {
      event: 'snapshot_recovery_start',
      node_id: this.config.node_id,
      peer_id: peer.id,
    });

    const snapshot = await this.requestSnapshot(peer);
    if (!snapshot) {
      return null;
    }

    const { applied, total } = this.applySnapshot(db, snapshot);

    this.raft.isCatchingUp = false;
    this.raft.appendDurableEntry('runtime', {
      event: 'snapshot_recovery_complete',
      node_id: this.config.node_id,
      peer_id: peer.id,
      rows_applied: applied,
      rows_total: total,
    });

    return { applied, total };
  }

  /**
   * Applies a snapshot to the local database, upserting all rows from all tables.
   * Stores the snapshot's version vector so future delta requests start from here.
   */
  private applySnapshot(
    db: Database,
    snapshot: ClusterSnapshot
  ): { applied: number; total: number } {
    let applied = 0;
    let total = 0;

    for (const adapter of REPLICATED_TABLES) {
      const rows = snapshot.tables[adapter.table];
      if (!rows) continue;
      total += rows.length;
      for (const row of rows) {
        adapter.upsert(db, row.payload);
        applied++;
      }
    }

    // Record the snapshot version vector so future delta requests
    // only ask for events newer than this snapshot
    setSnapshotVersionVector(db, snapshot.version_vector);

    return { applied, total };
  }

  /**
   * Builds a full snapshot of all replicated tables from the current db state.
   * Called during sync to keep cachedSnapshot fresh for the HTTP endpoint.
   */
  private buildSnapshot(db: Database): ClusterSnapshot {
    const tables: ClusterSnapshot['tables'] = {};

    for (const adapter of REPLICATED_TABLES) {
      const rows = queryAll<Record<string, unknown>>(db, adapter.selectSql);
      tables[adapter.table] = rows.map(row => ({
        rowId: adapter.rowId(row),
        payload: adapter.payload(row),
      }));
    }

    return {
      version_vector: getVersionVector(db),
      tables,
    };
  }

  private async requestDelta(
    peer: ClusterPeerConfig,
    versionVector: VersionVector,
    limit: number
  ): Promise<DeltaResponse | null> {
    return this.postJson<DeltaResponse>(peer, '/cluster/v1/events/delta', {
      version_vector: versionVector,
      limit,
      fencing_token: this.raft.getFencingToken(),
    });
  }

  private async requestSnapshot(peer: ClusterPeerConfig): Promise<ClusterSnapshot | null> {
    return this.getJson<ClusterSnapshot>(peer, '/cluster/v1/snapshot');
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

  private async getJson<T>(peer: ClusterPeerConfig, path: string): Promise<T | null> {
    const normalizedBase = peer.url.endsWith('/') ? peer.url : `${peer.url}/`;
    const url = new URL(path.replace(/^\//, ''), normalizedBase).toString();

    return fetchClusterStatusOrPostJson<T>(
      url,
      this.config.request_timeout_ms,
      this.config.auth_token,
      { method: 'GET' }
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

export async function fetchReplicationLag(
  config: ClusterConfig
): Promise<ReplicationLagSummary | null> {
  if (!config.enabled) return null;

  const host = config.listen_host === '0.0.0.0' ? '127.0.0.1' : config.listen_host;
  const url = `http://${host}:${config.listen_port}/cluster/v1/replication-lag`;

  return fetchClusterStatusOrPostJson<ReplicationLagSummary>(
    url,
    config.request_timeout_ms,
    config.auth_token,
    { method: 'GET' }
  );
}

/**
 * Fetches recent cluster events from the local runtime via the delta endpoint.
 * Uses an empty version vector to request recent events up to the given limit.
 */
export async function fetchLocalClusterEvents(
  config: ClusterConfig,
  limit: number = 50
): Promise<ClusterEvent[] | null> {
  if (!config.enabled) return null;

  const host = config.listen_host === '0.0.0.0' ? '127.0.0.1' : config.listen_host;
  const url = `http://${host}:${config.listen_port}/cluster/v1/events/delta`;

  const response = await fetchClusterStatusOrPostJson<{ events: ClusterEvent[] }>(
    url,
    config.request_timeout_ms,
    config.auth_token,
    { method: 'POST', body: { version_vector: {}, limit } }
  );

  return response?.events ?? null;
}

/**
 * POSTs to the local cluster runtime at the given path.
 */
export async function postToLocalCluster<T>(
  config: ClusterConfig,
  path: string,
  body: unknown
): Promise<T | null> {
  if (!config.enabled) return null;

  const host = config.listen_host === '0.0.0.0' ? '127.0.0.1' : config.listen_host;
  const url = `http://${host}:${config.listen_port}${path}`;

  return fetchClusterStatusOrPostJson<T>(url, config.request_timeout_ms, config.auth_token, {
    method: 'POST',
    body,
  });
}

/**
 * POSTs to a peer cluster node at the given URL and path.
 */
export async function postToPeerCluster<T>(
  peerUrl: string,
  path: string,
  body: unknown,
  options: ClusterStatusFetchOptions
): Promise<T | null> {
  const url = `${peerUrl.replace(/\/$/, '')}${path}`;
  return fetchClusterStatusOrPostJson<T>(url, options.timeoutMs, options.authToken, {
    method: 'POST',
    body,
  });
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
      fencing_token: 0,
      leader_lease_valid: true,
      leader_lease_duration_ms: config.leader_lease_ms ?? config.heartbeat_interval_ms * 3,
      raft_commit_index: 0,
      raft_last_applied: 0,
      raft_last_log_index: 0,
      peers: config.peers.map(peer => ({ id: peer.id, url: peer.url })),
      is_catching_up: false,
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
    fencing_token: toInt(input.fencing_token),
    leader_lease_valid: input.leader_lease_valid === true,
    leader_lease_duration_ms: toInt(input.leader_lease_duration_ms),
    raft_commit_index: toInt(input.raft_commit_index),
    raft_last_applied: toInt(input.raft_last_applied),
    raft_last_log_index: toInt(input.raft_last_log_index),
    peers,
    is_catching_up: input.is_catching_up === true,
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
