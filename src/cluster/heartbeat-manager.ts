// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { ClusterConfig, ClusterPeerConfig } from '../config/schema.js';
import type { RaftStateMachine } from './raft-state-machine.js';

interface HeartbeatRequest {
  term: number;
  leader_id: string;
  fencing_token: number;
  peers?: Array<{ id: string; url: string }>;
}

interface HeartbeatResponse {
  term: number;
  success: boolean;
  fencing_token: number;
}

export interface HeartbeatManagerDeps {
  raft: RaftStateMachine;
  postJson: <T>(peer: ClusterPeerConfig, path: string, body: unknown) => Promise<T | null>;
  isActive: () => boolean;
  handleBackgroundError: (error: unknown) => void;
  onPeersUpdated?: (peers: ClusterPeerConfig[]) => void;
}

export class HeartbeatManager {
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ClusterConfig,
    private readonly deps: HeartbeatManagerDeps
  ) {}

  startHeartbeatLoop(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.config.enabled) return;
      if (this.deps.raft.role !== 'leader') return;
      void this.sendHeartbeats().catch(error => this.deps.handleBackgroundError(error));
    }, this.config.heartbeat_interval_ms);
  }

  stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async sendHeartbeats(): Promise<void> {
    if (!this.deps.isActive()) return;

    const { raft } = this.deps;
    const peers = raft.getPeers();

    const heartbeat: HeartbeatRequest = {
      term: raft.currentTerm,
      leader_id: this.config.node_id,
      fencing_token: raft.getFencingToken(),
      peers: peers.map(p => ({ id: p.id, url: p.url })),
    };

    raft.appendDurableEntry('heartbeat_sent', {
      term: raft.currentTerm,
      leader_id: this.config.node_id,
      peer_count: peers.filter(peer => peer.id !== this.config.node_id).length,
    });

    await Promise.all(
      peers
        .filter(peer => peer.id !== this.config.node_id)
        .map(async peer => {
          const response = await this.deps.postJson<HeartbeatResponse>(
            peer,
            '/cluster/v1/election/heartbeat',
            heartbeat
          );

          if (response) {
            const remoteTerm = Math.max(response.term, response.fencing_token ?? 0);
            if (remoteTerm > raft.currentTerm) {
              raft.stepDown(remoteTerm, peer.id);
            }
          }
        })
    );
  }

  handleHeartbeat(body: unknown): HeartbeatResponse {
    const { raft } = this.deps;

    const request = body as Partial<HeartbeatRequest>;
    const term = Number(request.term || 0);
    const leaderId = typeof request.leader_id === 'string' ? request.leader_id : null;
    const fencingToken = Number(request.fencing_token ?? term);

    // Reject heartbeats from stale leaders
    if (term < raft.currentTerm) {
      return { term: raft.currentTerm, success: false, fencing_token: raft.getFencingToken() };
    }

    // Reject if fencing token doesn't match the heartbeat term
    if (fencingToken < term) {
      return { term: raft.currentTerm, success: false, fencing_token: raft.getFencingToken() };
    }

    const changed =
      term > raft.currentTerm || leaderId !== raft.leaderId || raft.role !== 'follower';

    if (term > raft.currentTerm) {
      raft.stepDown(term, leaderId);
    } else {
      raft.role = 'follower';
      raft.leaderId = leaderId;
      raft.persistRaftState();
    }

    // Update lease: record that we received a valid heartbeat now
    raft.lastHeartbeatReceivedAt = Date.now();
    raft.resetElectionDeadline();

    // Apply peer list from leader if present
    const requestPeers = (request as { peers?: unknown }).peers;
    if (Array.isArray(requestPeers)) {
      const parsed = parsePeerList(requestPeers);
      if (parsed.length > 0) {
        raft.setPeers(parsed);
        this.deps.onPeersUpdated?.(parsed);
      }
    }

    if (changed) {
      raft.appendDurableEntry('heartbeat_received', {
        term,
        leader_id: leaderId,
        fencing_token: fencingToken,
      });
    }

    return { term: raft.currentTerm, success: true, fencing_token: raft.getFencingToken() };
  }
}

function parsePeerList(input: unknown[]): ClusterPeerConfig[] {
  const peers: ClusterPeerConfig[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const p = item as { id?: unknown; url?: unknown };
    if (typeof p.id === 'string' && typeof p.url === 'string') {
      peers.push({ id: p.id, url: p.url });
    }
  }
  return peers;
}
