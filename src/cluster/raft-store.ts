// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ClusterEvent } from './replication.js';

export type DurableLogEntryType =
  | 'runtime'
  | 'election_start'
  | 'election_won'
  | 'vote_granted'
  | 'heartbeat_sent'
  | 'heartbeat_received'
  | 'state_transition'
  | 'cluster_event';

export interface DurableRaftState {
  node_id: string;
  current_term: number;
  voted_for: string | null;
  leader_id: string | null;
  commit_index: number;
  last_applied: number;
  last_log_index: number;
  last_log_term: number;
  updated_at: string;
}

export interface DurableRaftLogEntry {
  index: number;
  term: number;
  type: DurableLogEntryType;
  source_node_id: string;
  event_id: string | null;
  actor_id: string | null;
  actor_counter: number | null;
  table_name: string | null;
  row_id: string | null;
  op: string | null;
  payload_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface RaftStoreOptions {
  clusterDir: string;
  nodeId: string;
}

export class RaftMetadataStore {
  private readonly statePath: string;
  private readonly logPath: string;
  private readonly nodeId: string;

  private state: DurableRaftState;
  private knownEventIds = new Set<string>();

  constructor(options: RaftStoreOptions) {
    this.nodeId = options.nodeId;
    this.statePath = join(options.clusterDir, 'raft-state.json');
    this.logPath = join(options.clusterDir, 'raft-log.ndjson');

    mkdirSync(options.clusterDir, { recursive: true });

    this.state = this.loadOrCreateState();
    this.rebuildFromLog();
    this.persistState();
  }

  getState(): DurableRaftState {
    return { ...this.state };
  }

  setState(patch: Partial<DurableRaftState>): DurableRaftState {
    this.state = {
      ...this.state,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.persistState();
    return this.getState();
  }

  appendEntry(input: {
    type: DurableLogEntryType;
    term?: number;
    eventId?: string | null;
    actorId?: string | null;
    actorCounter?: number | null;
    tableName?: string | null;
    rowId?: string | null;
    op?: string | null;
    payloadHash?: string | null;
    metadata?: Record<string, unknown> | null;
  }): DurableRaftLogEntry {
    const entry: DurableRaftLogEntry = {
      index: this.state.last_log_index + 1,
      term: input.term ?? this.state.current_term,
      type: input.type,
      source_node_id: this.nodeId,
      event_id: input.eventId ?? null,
      actor_id: input.actorId ?? null,
      actor_counter: input.actorCounter ?? null,
      table_name: input.tableName ?? null,
      row_id: input.rowId ?? null,
      op: input.op ?? null,
      payload_hash: input.payloadHash ?? null,
      metadata: input.metadata ?? null,
      created_at: new Date().toISOString(),
    };

    appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf-8');

    if (entry.event_id) {
      this.knownEventIds.add(entry.event_id);
    }

    this.state = {
      ...this.state,
      last_log_index: entry.index,
      last_log_term: entry.term,
      commit_index: entry.index,
      last_applied: entry.index,
      updated_at: new Date().toISOString(),
    };

    this.persistState();
    return entry;
  }

  appendClusterEvents(events: ClusterEvent[], term: number): number {
    let appended = 0;

    const sorted = [...events].sort((a, b) => {
      if (a.version.logical_ts !== b.version.logical_ts) {
        return a.version.logical_ts - b.version.logical_ts;
      }
      if (a.version.actor_id !== b.version.actor_id) {
        return a.version.actor_id.localeCompare(b.version.actor_id);
      }
      return a.version.actor_counter - b.version.actor_counter;
    });

    for (const event of sorted) {
      if (this.knownEventIds.has(event.event_id)) continue;

      this.appendEntry({
        type: 'cluster_event',
        term,
        eventId: event.event_id,
        actorId: event.version.actor_id,
        actorCounter: event.version.actor_counter,
        tableName: event.table_name,
        rowId: event.row_id,
        op: event.op,
        payloadHash: event.payload ? hashPayload(event.payload) : null,
        metadata: {
          logical_ts: event.version.logical_ts,
          created_at: event.created_at,
        },
      });

      appended += 1;
    }

    return appended;
  }

  hasEvent(eventId: string): boolean {
    return this.knownEventIds.has(eventId);
  }

  private loadOrCreateState(): DurableRaftState {
    if (existsSync(this.statePath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(this.statePath, 'utf-8')
        ) as Partial<DurableRaftState>;
        return {
          node_id: parsed.node_id || this.nodeId,
          current_term: toNonNegativeInt(parsed.current_term),
          voted_for: parsed.voted_for || null,
          leader_id: parsed.leader_id || null,
          commit_index: toNonNegativeInt(parsed.commit_index),
          last_applied: toNonNegativeInt(parsed.last_applied),
          last_log_index: toNonNegativeInt(parsed.last_log_index),
          last_log_term: toNonNegativeInt(parsed.last_log_term),
          updated_at: parsed.updated_at || new Date().toISOString(),
        };
      } catch {
        // Fall through to a clean default state.
      }
    }

    return {
      node_id: this.nodeId,
      current_term: 0,
      voted_for: null,
      leader_id: null,
      commit_index: 0,
      last_applied: 0,
      last_log_index: 0,
      last_log_term: 0,
      updated_at: new Date().toISOString(),
    };
  }

  private rebuildFromLog(): void {
    if (!existsSync(this.logPath)) {
      return;
    }

    const content = readFileSync(this.logPath, 'utf-8');
    if (!content.trim()) return;

    const lines = content.split('\n').filter(Boolean);

    let maxIndex = this.state.last_log_index;
    let maxTerm = this.state.last_log_term;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Partial<DurableRaftLogEntry>;
        const index = toNonNegativeInt(entry.index);
        const term = toNonNegativeInt(entry.term);

        if (index > maxIndex) {
          maxIndex = index;
          maxTerm = term;
        }

        if (entry.event_id && typeof entry.event_id === 'string') {
          this.knownEventIds.add(entry.event_id);
        }
      } catch {
        // Skip malformed lines rather than failing startup.
      }
    }

    this.state.last_log_index = Math.max(this.state.last_log_index, maxIndex);
    this.state.last_log_term = Math.max(this.state.last_log_term, maxTerm);
    this.state.commit_index = Math.max(this.state.commit_index, this.state.last_log_index);
    this.state.last_applied = Math.max(this.state.last_applied, this.state.commit_index);
  }

  private persistState(): void {
    try {
      const temp = `${this.statePath}.tmp`;
      writeFileSync(temp, JSON.stringify(this.state, null, 2), 'utf-8');
      renameSync(temp, this.statePath);
    } catch (error) {
      // Gracefully handle ENOENT during shutdown when directory may be deleted
      // This can happen in tests or during rapid start/stop cycles
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => sortKeys(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      result[key] = sortKeys(obj[key]);
    }
    return result;
  }

  return value;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}
