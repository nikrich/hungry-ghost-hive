// Licensed under the Hungry Ghost Hive License. See LICENSE.

export type ReplicatedTable =
  | 'teams'
  | 'agents'
  | 'requirements'
  | 'stories'
  | 'story_dependencies'
  | 'agent_logs'
  | 'escalations'
  | 'pull_requests'
  | 'messages';

export type ReplicationOp = 'upsert' | 'delete';

export interface ClusterEventVersion {
  actor_id: string;
  actor_counter: number;
  logical_ts: number;
}

export interface ClusterEvent {
  event_id: string;
  table_name: ReplicatedTable;
  row_id: string;
  op: ReplicationOp;
  payload: Record<string, unknown> | null;
  version: ClusterEventVersion;
  created_at: string;
}

export type VersionVector = Record<string, number>;

export interface ClusterEventRow {
  event_id: string;
  actor_id: string;
  actor_counter: number;
  logical_ts: number;
  table_name: ReplicatedTable;
  row_id: string;
  op: ReplicationOp;
  payload: string | null;
  created_at: string;
}

export interface RowVersionRow {
  table_name: ReplicatedTable;
  row_id: string;
  actor_id: string;
  actor_counter: number;
  logical_ts: number;
}

export interface TableRowSnapshot {
  rowId: string;
  payload: Record<string, unknown>;
  rowHash: string;
}

export interface StoryRecord {
  id: string;
  requirement_id: string | null;
  team_id: string | null;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  complexity_score: number | null;
  story_points: number | null;
  status:
    | 'draft'
    | 'estimated'
    | 'planned'
    | 'in_progress'
    | 'review'
    | 'qa'
    | 'qa_failed'
    | 'pr_submitted'
    | 'merged';
  assigned_agent_id: string | null;
  branch_name: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TableAdapter {
  table: ReplicatedTable;
  selectSql: string;
  rowId: (row: Record<string, unknown>) => string;
  payload: (row: Record<string, unknown>) => Record<string, unknown>;
  upsert: (db: Database.Database, payload: Record<string, unknown>) => void;
  delete: (db: Database.Database, rowId: string) => void;
}

// Re-import Database type for TableAdapter interface
import type Database from 'better-sqlite3';
// @ts-ignore Database.Database type;
