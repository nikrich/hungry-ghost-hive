// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { ClusterConfig, ClusterPeerConfig } from '../config/schema.js';
import type { CompactionResult, DurableLogEntryType } from './raft-store.js';
import { RaftMetadataStore } from './raft-store.js';
import type { VersionVector } from './types.js';

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

export interface RaftStateMachineDeps {
  postJson: <T>(peer: ClusterPeerConfig, path: string, body: unknown) => Promise<T | null>;
  isActive: () => boolean;
  handleBackgroundError: (error: unknown) => void;
}

export class RaftStateMachine {
  role: NodeRole = 'follower';
  currentTerm = 0;
  votedFor: string | null = null;
  leaderId: string | null = null;
  lastHeartbeatReceivedAt = 0;

  /**
   * When true, this node is catching up from a snapshot and must not
   * participate in leader elections until fully recovered.
   */
  isCatchingUp = false;

  /** Dynamic peer list that can be updated at runtime via membership changes. */
  private dynamicPeers: ClusterPeerConfig[] | null = null;

  private electionDeadline = 0;
  private electionInFlight = false;
  private electionTimer: NodeJS.Timeout | null = null;
  private raftStore: RaftMetadataStore | null = null;

  constructor(
    private readonly config: ClusterConfig,
    private readonly deps: RaftStateMachineDeps
  ) {}

  /** Returns the active peer list (dynamic if set, otherwise static config). */
  getPeers(): ClusterPeerConfig[] {
    return this.dynamicPeers ?? this.config.peers;
  }

  /** Replaces the dynamic peer list. */
  setPeers(peers: ClusterPeerConfig[]): void {
    this.dynamicPeers = peers;
  }

  /** Returns the leader lease window in milliseconds. */
  get leaderLeaseDurationMs(): number {
    return this.config.leader_lease_ms ?? this.config.heartbeat_interval_ms * 3;
  }

  /**
   * Returns true when this follower has received a valid heartbeat
   * from the current leader within the lease window.
   */
  isLeaderLeaseValid(): boolean {
    if (this.role === 'leader') return true;
    if (this.lastHeartbeatReceivedAt === 0) return false;
    return Date.now() - this.lastHeartbeatReceivedAt < this.leaderLeaseDurationMs;
  }

  /**
   * The fencing token is the current Raft term. Operations tagged with a
   * lower term than ours must be rejected to prevent stale-leader writes.
   */
  getFencingToken(): number {
    return this.currentTerm;
  }

  /**
   * Validates a fencing token from a remote node. Returns true when the
   * token is at least as recent as our current term.
   */
  validateFencingToken(token: number): boolean {
    return token >= this.currentTerm;
  }

  initializeRaftStore(hiveDir: string): void {
    if (this.raftStore) return;

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

  getRaftStore(): RaftMetadataStore | null {
    return this.raftStore;
  }

  clearRaftStore(): void {
    this.raftStore = null;
  }

  startElectionLoop(): void {
    this.resetElectionDeadline();
    this.electionTimer = setInterval(() => {
      if (!this.config.enabled) return;
      if (this.role === 'leader') return;
      // Do not start elections while catching up from a snapshot — the node
      // must not become leader until it has a complete, current state.
      if (this.isCatchingUp) {
        this.resetElectionDeadline();
        return;
      }

      if (Date.now() >= this.electionDeadline) {
        void this.startElection().catch(error => this.deps.handleBackgroundError(error));
      }
    }, 250);
  }

  stopElectionLoop(): void {
    if (this.electionTimer) {
      clearInterval(this.electionTimer);
      this.electionTimer = null;
    }
    this.electionInFlight = false;
  }

  async startElection(): Promise<void> {
    if (!this.config.enabled || this.electionInFlight || !this.deps.isActive()) return;

    this.electionInFlight = true;
    const electionTerm = this.currentTerm + 1;

    this.currentTerm = electionTerm;
    this.role = 'candidate';
    this.votedFor = this.config.node_id;
    this.leaderId = null;
    this.resetElectionDeadline();
    this.persistRaftState();
    this.appendDurableEntry('election_start', {
      term: electionTerm,
      candidate_id: this.config.node_id,
    });

    let votes = 1;

    try {
      await Promise.all(
        this.getPeers()
          .filter(peer => peer.id !== this.config.node_id)
          .map(async peer => {
            const response = await this.deps.postJson<VoteResponse>(
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
        this.persistRaftState();
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

  handleVoteRequest(body: unknown): VoteResponse {
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
      this.persistRaftState();
      this.appendDurableEntry('vote_granted', {
        term: this.currentTerm,
        candidate_id: candidateId,
      });
      return { term: this.currentTerm, vote_granted: true, leader_id: this.leaderId };
    }

    return { term: this.currentTerm, vote_granted: false, leader_id: this.leaderId };
  }

  stepDown(term: number, leaderId: string | null): void {
    const previousRole = this.role;
    const previousTerm = this.currentTerm;

    this.currentTerm = term;
    this.role = 'follower';
    this.votedFor = null;
    this.leaderId = leaderId;
    this.lastHeartbeatReceivedAt = 0;
    this.resetElectionDeadline();
    this.persistRaftState();

    this.appendDurableEntry('state_transition', {
      previous_role: previousRole,
      previous_term: previousTerm,
      current_term: this.currentTerm,
      leader_id: leaderId,
    });
  }

  quorum(): number {
    const nodes = this.getPeers().length + 1;
    return Math.floor(nodes / 2) + 1;
  }

  resetElectionDeadline(): void {
    const min = this.config.election_timeout_min_ms;
    const max = Math.max(min, this.config.election_timeout_max_ms);
    const spread = max - min;
    const jitter = spread === 0 ? 0 : Math.floor(Math.random() * spread);
    this.electionDeadline = Date.now() + min + jitter;
  }

  persistRaftState(): void {
    if (!this.raftStore) return;

    this.raftStore.setState({
      current_term: this.currentTerm,
      voted_for: this.votedFor,
      leader_id: this.leaderId,
    });
  }

  appendDurableEntry(type: DurableLogEntryType, metadata: Record<string, unknown>): void {
    if (!this.raftStore) return;

    try {
      this.raftStore.appendEntry({ type, term: this.currentTerm, metadata });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return;
      throw error;
    }
  }

  appendClusterEventsToDurableLog(events: import('./replication.js').ClusterEvent[]): number {
    if (!this.raftStore) return 0;

    const appended = this.raftStore.appendClusterEvents(events, this.currentTerm);
    this.persistRaftState();
    return appended;
  }

  getRaftStoreState(): {
    commit_index: number;
    last_applied: number;
    last_log_index: number;
  } | null {
    return this.raftStore?.getState() ?? null;
  }

  getLogEntryCount(): number {
    return this.raftStore?.getLogEntryCount() ?? 0;
  }

  createSnapshotAndCompact(versionVector: VersionVector): CompactionResult {
    if (!this.raftStore) {
      return { entries_removed: 0, entries_retained: 0, snapshot_index: 0 };
    }

    this.raftStore.createSnapshot(versionVector);
    return this.raftStore.compactLog();
  }

  getLeaderUrl(): string | null {
    if (!this.leaderId) return null;
    if (this.leaderId === this.config.node_id) return this.config.public_url;

    const peer = this.getPeers().find(item => item.id === this.leaderId);
    return peer?.url || null;
  }
}
