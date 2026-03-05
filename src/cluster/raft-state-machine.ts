// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { ClusterConfig, ClusterPeerConfig } from '../config/schema.js';
import type { DurableLogEntryType } from './raft-store.js';
import { RaftMetadataStore } from './raft-store.js';

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

  private electionDeadline = 0;
  private electionInFlight = false;
  private electionTimer: NodeJS.Timeout | null = null;
  private raftStore: RaftMetadataStore | null = null;

  constructor(
    private readonly config: ClusterConfig,
    private readonly deps: RaftStateMachineDeps
  ) {}

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
        this.config.peers
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
    const nodes = this.config.peers.length + 1;
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

  appendDurableEntry(
    type: DurableLogEntryType,
    metadata: Record<string, unknown>
  ): void {
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

  getRaftStoreState(): { commit_index: number; last_applied: number; last_log_index: number } | null {
    return this.raftStore?.getState() ?? null;
  }

  getLeaderUrl(): string | null {
    if (!this.leaderId) return null;
    if (this.leaderId === this.config.node_id) return this.config.public_url;

    const peer = this.config.peers.find(item => item.id === this.leaderId);
    return peer?.url || null;
  }
}
