import { createHash } from 'crypto';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/client.js';

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

interface ClusterEventRow {
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

interface RowVersionRow {
  table_name: ReplicatedTable;
  row_id: string;
  actor_id: string;
  actor_counter: number;
  logical_ts: number;
}

interface TableRowSnapshot {
  rowId: string;
  payload: Record<string, unknown>;
  rowHash: string;
}

interface StoryRecord {
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

interface TableAdapter {
  table: ReplicatedTable;
  selectSql: string;
  rowId: (row: Record<string, unknown>) => string;
  payload: (row: Record<string, unknown>) => Record<string, unknown>;
  upsert: (db: Database, payload: Record<string, unknown>) => void;
  delete: (db: Database, rowId: string) => void;
}

const STORY_STATUS_ORDER: Array<StoryRecord['status']> = [
  'draft',
  'estimated',
  'planned',
  'in_progress',
  'review',
  'qa',
  'qa_failed',
  'pr_submitted',
  'merged',
];

const REPLICATED_TABLES: TableAdapter[] = [
  {
    table: 'teams',
    selectSql: 'SELECT id, repo_url, repo_path, name, created_at FROM teams ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      repo_url: asString(row.repo_url),
      repo_path: asString(row.repo_path),
      name: asString(row.name),
      created_at: asString(row.created_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO teams (id, repo_url, repo_path, name, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          repo_url = excluded.repo_url,
          repo_path = excluded.repo_path,
          name = excluded.name,
          created_at = excluded.created_at
      `,
        [
          asString(payload.id),
          asString(payload.repo_url),
          asString(payload.repo_path),
          asString(payload.name),
          asString(payload.created_at),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM teams WHERE id = ?', [rowId]);
    },
  },
  {
    table: 'agents',
    selectSql:
      'SELECT id, type, team_id, tmux_session, model, status, current_story_id, memory_state, created_at, updated_at, last_seen, worktree_path FROM agents ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      type: asString(row.type),
      team_id: asNullableString(row.team_id),
      tmux_session: asNullableString(row.tmux_session),
      model: asNullableString(row.model),
      status: asString(row.status),
      current_story_id: asNullableString(row.current_story_id),
      memory_state: asNullableString(row.memory_state),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      last_seen: asNullableString(row.last_seen),
      worktree_path: asNullableString(row.worktree_path),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO agents (id, type, team_id, tmux_session, model, status, current_story_id, memory_state, created_at, updated_at, last_seen, worktree_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          team_id = excluded.team_id,
          tmux_session = excluded.tmux_session,
          model = excluded.model,
          status = excluded.status,
          current_story_id = excluded.current_story_id,
          memory_state = excluded.memory_state,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_seen = excluded.last_seen,
          worktree_path = excluded.worktree_path
      `,
        [
          asString(payload.id),
          asString(payload.type),
          asNullableString(payload.team_id),
          asNullableString(payload.tmux_session),
          asNullableString(payload.model),
          asString(payload.status),
          asNullableString(payload.current_story_id),
          asNullableString(payload.memory_state),
          asString(payload.created_at),
          asString(payload.updated_at),
          asNullableString(payload.last_seen),
          asNullableString(payload.worktree_path),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM agents WHERE id = ?', [rowId]);
    },
  },
  {
    table: 'requirements',
    selectSql:
      'SELECT id, title, description, submitted_by, status, godmode, created_at FROM requirements ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      title: asString(row.title),
      description: asString(row.description),
      submitted_by: asString(row.submitted_by),
      status: asString(row.status),
      godmode: asNumber(row.godmode),
      created_at: asString(row.created_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO requirements (id, title, description, submitted_by, status, godmode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          submitted_by = excluded.submitted_by,
          status = excluded.status,
          godmode = excluded.godmode,
          created_at = excluded.created_at
      `,
        [
          asString(payload.id),
          asString(payload.title),
          asString(payload.description),
          asString(payload.submitted_by),
          asString(payload.status),
          asNumber(payload.godmode),
          asString(payload.created_at),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM requirements WHERE id = ?', [rowId]);
    },
  },
  {
    table: 'stories',
    selectSql:
      'SELECT id, requirement_id, team_id, title, description, acceptance_criteria, complexity_score, story_points, status, assigned_agent_id, branch_name, pr_url, created_at, updated_at FROM stories ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      requirement_id: asNullableString(row.requirement_id),
      team_id: asNullableString(row.team_id),
      title: asString(row.title),
      description: asString(row.description),
      acceptance_criteria: asNullableString(row.acceptance_criteria),
      complexity_score: asNullableNumber(row.complexity_score),
      story_points: asNullableNumber(row.story_points),
      status: asString(row.status),
      assigned_agent_id: asNullableString(row.assigned_agent_id),
      branch_name: asNullableString(row.branch_name),
      pr_url: asNullableString(row.pr_url),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO stories (id, requirement_id, team_id, title, description, acceptance_criteria, complexity_score, story_points, status, assigned_agent_id, branch_name, pr_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          requirement_id = excluded.requirement_id,
          team_id = excluded.team_id,
          title = excluded.title,
          description = excluded.description,
          acceptance_criteria = excluded.acceptance_criteria,
          complexity_score = excluded.complexity_score,
          story_points = excluded.story_points,
          status = excluded.status,
          assigned_agent_id = excluded.assigned_agent_id,
          branch_name = excluded.branch_name,
          pr_url = excluded.pr_url,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
        [
          asString(payload.id),
          asNullableString(payload.requirement_id),
          asNullableString(payload.team_id),
          asString(payload.title),
          asString(payload.description),
          asNullableString(payload.acceptance_criteria),
          asNullableNumber(payload.complexity_score),
          asNullableNumber(payload.story_points),
          asString(payload.status),
          asNullableString(payload.assigned_agent_id),
          asNullableString(payload.branch_name),
          asNullableString(payload.pr_url),
          asString(payload.created_at),
          asString(payload.updated_at),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [
        rowId,
        rowId,
      ]);
      run(db, 'DELETE FROM stories WHERE id = ?', [rowId]);
    },
  },
  {
    table: 'story_dependencies',
    selectSql:
      'SELECT story_id, depends_on_story_id FROM story_dependencies ORDER BY story_id, depends_on_story_id',
    rowId: row => `${asString(row.story_id)}::${asString(row.depends_on_story_id)}`,
    payload: row => ({
      story_id: asString(row.story_id),
      depends_on_story_id: asString(row.depends_on_story_id),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
        VALUES (?, ?)
      `,
        [asString(payload.story_id), asString(payload.depends_on_story_id)]
      );
    },
    delete: (db, rowId) => {
      const [storyId, dependsOnId] = splitDependencyRowId(rowId);
      run(db, 'DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?', [
        storyId,
        dependsOnId,
      ]);
    },
  },
  {
    table: 'agent_logs',
    selectSql:
      'SELECT id, agent_id, story_id, event_type, status, message, metadata, timestamp FROM agent_logs ORDER BY timestamp, id',
    rowId: row => {
      const payload = toAgentLogPayload(row);
      return hashPayload(payload);
    },
    payload: row => toAgentLogPayload(row),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          asString(payload.agent_id),
          asNullableString(payload.story_id),
          asString(payload.event_type),
          asNullableString(payload.status),
          asNullableString(payload.message),
          asNullableString(payload.metadata),
          asString(payload.timestamp),
        ]
      );
    },
    delete: (db, rowId) => {
      deleteAgentLogByRowId(db, rowId);
    },
  },
  {
    table: 'escalations',
    selectSql:
      'SELECT id, story_id, from_agent_id, to_agent_id, reason, status, resolution, created_at, resolved_at FROM escalations ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      story_id: asNullableString(row.story_id),
      from_agent_id: asNullableString(row.from_agent_id),
      to_agent_id: asNullableString(row.to_agent_id),
      reason: asString(row.reason),
      status: asString(row.status),
      resolution: asNullableString(row.resolution),
      created_at: asString(row.created_at),
      resolved_at: asNullableString(row.resolved_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason, status, resolution, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          story_id = excluded.story_id,
          from_agent_id = excluded.from_agent_id,
          to_agent_id = excluded.to_agent_id,
          reason = excluded.reason,
          status = excluded.status,
          resolution = excluded.resolution,
          created_at = excluded.created_at,
          resolved_at = excluded.resolved_at
      `,
        [
          asString(payload.id),
          asNullableString(payload.story_id),
          asNullableString(payload.from_agent_id),
          asNullableString(payload.to_agent_id),
          asString(payload.reason),
          asString(payload.status),
          asNullableString(payload.resolution),
          asString(payload.created_at),
          asNullableString(payload.resolved_at),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM escalations WHERE id = ?', [rowId]);
    },
  },
  {
    table: 'pull_requests',
    selectSql:
      'SELECT id, story_id, team_id, branch_name, github_pr_number, github_pr_url, submitted_by, reviewed_by, status, review_notes, created_at, updated_at, reviewed_at FROM pull_requests ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      story_id: asNullableString(row.story_id),
      team_id: asNullableString(row.team_id),
      branch_name: asString(row.branch_name),
      github_pr_number: asNullableNumber(row.github_pr_number),
      github_pr_url: asNullableString(row.github_pr_url),
      submitted_by: asNullableString(row.submitted_by),
      reviewed_by: asNullableString(row.reviewed_by),
      status: asString(row.status),
      review_notes: asNullableString(row.review_notes),
      created_at: asString(row.created_at),
      updated_at: asString(row.updated_at),
      reviewed_at: asNullableString(row.reviewed_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_number, github_pr_url, submitted_by, reviewed_by, status, review_notes, created_at, updated_at, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          story_id = excluded.story_id,
          team_id = excluded.team_id,
          branch_name = excluded.branch_name,
          github_pr_number = excluded.github_pr_number,
          github_pr_url = excluded.github_pr_url,
          submitted_by = excluded.submitted_by,
          reviewed_by = excluded.reviewed_by,
          status = excluded.status,
          review_notes = excluded.review_notes,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          reviewed_at = excluded.reviewed_at
      `,
        [
          asString(payload.id),
          asNullableString(payload.story_id),
          asNullableString(payload.team_id),
          asString(payload.branch_name),
          asNullableNumber(payload.github_pr_number),
          asNullableString(payload.github_pr_url),
          asNullableString(payload.submitted_by),
          asNullableString(payload.reviewed_by),
          asString(payload.status),
          asNullableString(payload.review_notes),
          asString(payload.created_at),
          asString(payload.updated_at),
          asNullableString(payload.reviewed_at),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM pull_requests WHERE id = ?', [rowId]);
    },
  },
  {
    table: 'messages',
    selectSql:
      'SELECT id, from_session, to_session, subject, body, reply, status, created_at, replied_at FROM messages ORDER BY id',
    rowId: row => asString(row.id),
    payload: row => ({
      id: asString(row.id),
      from_session: asString(row.from_session),
      to_session: asString(row.to_session),
      subject: asNullableString(row.subject),
      body: asString(row.body),
      reply: asNullableString(row.reply),
      status: asString(row.status),
      created_at: asString(row.created_at),
      replied_at: asNullableString(row.replied_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO messages (id, from_session, to_session, subject, body, reply, status, created_at, replied_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          from_session = excluded.from_session,
          to_session = excluded.to_session,
          subject = excluded.subject,
          body = excluded.body,
          reply = excluded.reply,
          status = excluded.status,
          created_at = excluded.created_at,
          replied_at = excluded.replied_at
      `,
        [
          asString(payload.id),
          asString(payload.from_session),
          asString(payload.to_session),
          asNullableString(payload.subject),
          asString(payload.body),
          asNullableString(payload.reply),
          asString(payload.status),
          asString(payload.created_at),
          asNullableString(payload.replied_at),
        ]
      );
    },
    delete: (db, rowId) => {
      run(db, 'DELETE FROM messages WHERE id = ?', [rowId]);
    },
  },
];

const ADAPTERS_BY_TABLE = new Map<ReplicatedTable, TableAdapter>(
  REPLICATED_TABLES.map(adapter => [adapter.table, adapter])
);

export function ensureClusterTables(db: Database, nodeId: string): void {
  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      node_id TEXT NOT NULL,
      event_counter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_events (
      event_id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_counter INTEGER NOT NULL,
      logical_ts INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK(op IN ('upsert', 'delete')),
      payload TEXT,
      created_at TEXT NOT NULL
    )
  `
  );

  run(
    db,
    `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cluster_events_actor_counter
    ON cluster_events(actor_id, actor_counter)
  `
  );

  run(
    db,
    `
    CREATE INDEX IF NOT EXISTS idx_cluster_events_logical_ts
    ON cluster_events(logical_ts)
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_row_versions (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_counter INTEGER NOT NULL,
      logical_ts INTEGER NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_row_hashes (
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      row_hash TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
    )
  `
  );

  run(
    db,
    `
    CREATE TABLE IF NOT EXISTS cluster_story_merges (
      duplicate_story_id TEXT PRIMARY KEY,
      canonical_story_id TEXT NOT NULL,
      merged_at TEXT NOT NULL
    )
  `
  );

  const state = queryOne<{ id: number }>(db, 'SELECT id FROM cluster_state WHERE id = 1');
  const now = new Date().toISOString();

  if (!state) {
    run(
      db,
      'INSERT INTO cluster_state (id, node_id, event_counter, updated_at) VALUES (1, ?, 0, ?)',
      [nodeId, now]
    );
  } else {
    run(db, 'UPDATE cluster_state SET node_id = ?, updated_at = ? WHERE id = 1', [nodeId, now]);
  }
}

export function getVersionVector(db: Database): VersionVector {
  const rows = queryAll<{ actor_id: string; max_counter: number }>(
    db,
    `
    SELECT actor_id, MAX(actor_counter) as max_counter
    FROM cluster_events
    GROUP BY actor_id
  `
  );

  const vector: VersionVector = {};
  for (const row of rows) {
    vector[row.actor_id] = Number(row.max_counter) || 0;
  }

  return vector;
}

export function getAllClusterEvents(db: Database): ClusterEvent[] {
  const rows = queryAll<ClusterEventRow>(
    db,
    `
    SELECT event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at
    FROM cluster_events
    ORDER BY logical_ts ASC, actor_id ASC, actor_counter ASC
  `
  );

  return rows.map(mapEventRow);
}

export function getDeltaEvents(
  db: Database,
  remoteVersionVector: VersionVector,
  limit = 2000
): ClusterEvent[] {
  const events = getAllClusterEvents(db);
  const missing = events.filter(event => {
    const known = remoteVersionVector[event.version.actor_id] || 0;
    return event.version.actor_counter > known;
  });

  return missing.slice(0, limit);
}

export function scanLocalChanges(db: Database, nodeId: string): number {
  ensureClusterTables(db, nodeId);

  let emitted = 0;

  for (const adapter of REPLICATED_TABLES) {
    const knownRows = queryAll<{ row_id: string; row_hash: string }>(
      db,
      'SELECT row_id, row_hash FROM cluster_row_hashes WHERE table_name = ?',
      [adapter.table]
    );

    const knownMap = new Map<string, string>(knownRows.map(row => [row.row_id, row.row_hash]));
    const seenIds = new Set<string>();

    const currentRows = fetchTableSnapshots(db, adapter);

    for (const row of currentRows) {
      seenIds.add(row.rowId);
      const previousHash = knownMap.get(row.rowId);

      if (previousHash !== row.rowHash) {
        emitLocalEvent(db, nodeId, {
          table_name: adapter.table,
          row_id: row.rowId,
          op: 'upsert',
          payload: row.payload,
        });
        emitted += 1;
      }

      run(
        db,
        `
        INSERT INTO cluster_row_hashes (table_name, row_id, row_hash)
        VALUES (?, ?, ?)
        ON CONFLICT(table_name, row_id) DO UPDATE SET row_hash = excluded.row_hash
      `,
        [adapter.table, row.rowId, row.rowHash]
      );
    }

    for (const previous of knownRows) {
      if (seenIds.has(previous.row_id)) continue;

      emitLocalEvent(db, nodeId, {
        table_name: adapter.table,
        row_id: previous.row_id,
        op: 'delete',
        payload: null,
      });
      emitted += 1;

      run(db, 'DELETE FROM cluster_row_hashes WHERE table_name = ? AND row_id = ?', [
        adapter.table,
        previous.row_id,
      ]);
    }
  }

  return emitted;
}

export function applyRemoteEvents(db: Database, nodeId: string, events: ClusterEvent[]): number {
  ensureClusterTables(db, nodeId);

  let applied = 0;
  const sorted = [...events].sort((a, b) => compareVersion(a.version, b.version));

  for (const event of sorted) {
    const existing = queryOne<{ event_id: string }>(
      db,
      'SELECT event_id FROM cluster_events WHERE event_id = ?',
      [event.event_id]
    );

    if (existing) continue;

    const adapter = ADAPTERS_BY_TABLE.get(event.table_name);
    if (!adapter) continue;

    const shouldApply = shouldApplyEvent(db, event);

    if (shouldApply) {
      if (event.op === 'upsert' && event.payload) {
        adapter.upsert(db, event.payload);
        setRowHash(db, event.table_name, event.row_id, hashPayload(event.payload));
      } else if (event.op === 'delete') {
        adapter.delete(db, event.row_id);
        run(db, 'DELETE FROM cluster_row_hashes WHERE table_name = ? AND row_id = ?', [
          event.table_name,
          event.row_id,
        ]);
      }

      run(
        db,
        `
        INSERT INTO cluster_row_versions (table_name, row_id, actor_id, actor_counter, logical_ts)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(table_name, row_id) DO UPDATE SET
          actor_id = excluded.actor_id,
          actor_counter = excluded.actor_counter,
          logical_ts = excluded.logical_ts
      `,
        [
          event.table_name,
          event.row_id,
          event.version.actor_id,
          event.version.actor_counter,
          event.version.logical_ts,
        ]
      );

      applied += 1;
    }

    run(
      db,
      `
      INSERT OR IGNORE INTO cluster_events (event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        event.event_id,
        event.version.actor_id,
        event.version.actor_counter,
        event.version.logical_ts,
        event.table_name,
        event.row_id,
        event.op,
        event.payload ? stableStringify(event.payload) : null,
        event.created_at,
      ]
    );
  }

  return applied;
}

export function mergeSimilarStories(db: Database, similarityThreshold: number): number {
  ensureClusterTables(db, 'node-local');

  const stories = queryAll<StoryRecord>(
    db,
    `
    SELECT id, requirement_id, team_id, title, description, acceptance_criteria, complexity_score, story_points, status,
           assigned_agent_id, branch_name, pr_url, created_at, updated_at
    FROM stories
    WHERE status != 'merged'
    ORDER BY id
  `
  );

  if (stories.length < 2) return 0;

  const parent = new Map<string, string>();
  for (const story of stories) {
    parent.set(story.id, story.id);
  }

  const find = (id: string): string => {
    const root = parent.get(id);
    if (!root) return id;
    if (root === id) return id;
    const compressed = find(root);
    parent.set(id, compressed);
    return compressed;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const canonical = rootA < rootB ? rootA : rootB;
    const other = canonical === rootA ? rootB : rootA;
    parent.set(other, canonical);
  };

  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      const a = stories[i];
      const b = stories[j];

      if ((a.team_id || null) !== (b.team_id || null)) continue;
      if ((a.requirement_id || null) !== (b.requirement_id || null)) continue;

      const similarity = storySimilarity(a, b);
      if (similarity >= similarityThreshold) {
        union(a.id, b.id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const story of stories) {
    const root = find(story.id);
    const group = groups.get(root) || [];
    group.push(story.id);
    groups.set(root, group);
  }

  let merged = 0;

  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const canonical = sorted[0];

    for (const duplicate of sorted.slice(1)) {
      const alreadyMerged = queryOne<{ duplicate_story_id: string }>(
        db,
        'SELECT duplicate_story_id FROM cluster_story_merges WHERE duplicate_story_id = ?',
        [duplicate]
      );

      if (alreadyMerged) continue;

      if (mergeStoryIntoCanonical(db, canonical, duplicate)) {
        merged += 1;
      }
    }
  }

  return merged;
}

function mergeStoryIntoCanonical(db: Database, canonicalId: string, duplicateId: string): boolean {
  const canonical = queryOne<StoryRecord>(db, 'SELECT * FROM stories WHERE id = ?', [canonicalId]);
  const duplicate = queryOne<StoryRecord>(db, 'SELECT * FROM stories WHERE id = ?', [duplicateId]);

  if (!canonical || !duplicate) return false;

  const mergedStatus =
    STORY_STATUS_ORDER.indexOf(canonical.status) >= STORY_STATUS_ORDER.indexOf(duplicate.status)
      ? canonical.status
      : duplicate.status;

  const mergedTitle = pickLonger(canonical.title, duplicate.title);
  const mergedDescription = pickLonger(canonical.description, duplicate.description);

  run(
    db,
    `
    UPDATE stories
    SET
      title = ?,
      description = ?,
      acceptance_criteria = COALESCE(acceptance_criteria, ?),
      complexity_score = CASE
        WHEN complexity_score IS NULL THEN ?
        WHEN ? IS NULL THEN complexity_score
        WHEN complexity_score >= ? THEN complexity_score
        ELSE ?
      END,
      story_points = CASE
        WHEN story_points IS NULL THEN ?
        WHEN ? IS NULL THEN story_points
        WHEN story_points >= ? THEN story_points
        ELSE ?
      END,
      status = ?,
      assigned_agent_id = COALESCE(assigned_agent_id, ?),
      branch_name = COALESCE(branch_name, ?),
      pr_url = COALESCE(pr_url, ?),
      updated_at = ?
    WHERE id = ?
  `,
    [
      mergedTitle,
      mergedDescription,
      duplicate.acceptance_criteria,
      duplicate.complexity_score,
      duplicate.complexity_score,
      duplicate.complexity_score,
      duplicate.complexity_score,
      duplicate.story_points,
      duplicate.story_points,
      duplicate.story_points,
      duplicate.story_points,
      mergedStatus,
      duplicate.assigned_agent_id,
      duplicate.branch_name,
      duplicate.pr_url,
      new Date().toISOString(),
      canonicalId,
    ]
  );

  // Rebind all references to canonical story.
  run(db, 'UPDATE pull_requests SET story_id = ? WHERE story_id = ?', [canonicalId, duplicateId]);
  run(db, 'UPDATE escalations SET story_id = ? WHERE story_id = ?', [canonicalId, duplicateId]);
  run(db, 'UPDATE agent_logs SET story_id = ? WHERE story_id = ?', [canonicalId, duplicateId]);
  run(db, 'UPDATE agents SET current_story_id = ? WHERE current_story_id = ?', [
    canonicalId,
    duplicateId,
  ]);

  run(
    db,
    `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    SELECT ?, depends_on_story_id
    FROM story_dependencies
    WHERE story_id = ?
  `,
    [canonicalId, duplicateId]
  );

  run(
    db,
    `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    SELECT story_id, ?
    FROM story_dependencies
    WHERE depends_on_story_id = ?
  `,
    [canonicalId, duplicateId]
  );

  run(db, 'DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [
    duplicateId,
    duplicateId,
  ]);
  run(db, 'DELETE FROM story_dependencies WHERE story_id = depends_on_story_id');

  run(db, 'DELETE FROM stories WHERE id = ?', [duplicateId]);

  run(
    db,
    'INSERT INTO cluster_story_merges (duplicate_story_id, canonical_story_id, merged_at) VALUES (?, ?, ?)',
    [duplicateId, canonicalId, new Date().toISOString()]
  );

  return true;
}

function storySimilarity(a: StoryRecord, b: StoryRecord): number {
  const tokensA = toTokenSet(`${a.title} ${a.description}`);
  const tokensB = toTokenSet(`${b.title} ${b.description}`);

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }

  const union = tokensA.size + tokensB.size - overlap;
  if (union === 0) return 0;

  return overlap / union;
}

function toTokenSet(input: string): Set<string> {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3);

  return new Set(normalized);
}

function pickLonger(a: string, b: string): string {
  return (b || '').length > (a || '').length ? b : a;
}

function shouldApplyEvent(db: Database, event: ClusterEvent): boolean {
  const existing = queryOne<RowVersionRow>(
    db,
    `
    SELECT table_name, row_id, actor_id, actor_counter, logical_ts
    FROM cluster_row_versions
    WHERE table_name = ? AND row_id = ?
  `,
    [event.table_name, event.row_id]
  );

  if (!existing) return true;

  return (
    compareVersion(event.version, {
      actor_id: existing.actor_id,
      actor_counter: Number(existing.actor_counter),
      logical_ts: Number(existing.logical_ts),
    }) > 0
  );
}

function compareVersion(a: ClusterEventVersion, b: ClusterEventVersion): number {
  if (a.logical_ts !== b.logical_ts) {
    return a.logical_ts - b.logical_ts;
  }

  if (a.actor_id !== b.actor_id) {
    return a.actor_id.localeCompare(b.actor_id);
  }

  return a.actor_counter - b.actor_counter;
}

function mapEventRow(row: ClusterEventRow): ClusterEvent {
  return {
    event_id: row.event_id,
    table_name: row.table_name,
    row_id: row.row_id,
    op: row.op,
    payload: row.payload ? toObject(JSON.parse(row.payload)) : null,
    version: {
      actor_id: row.actor_id,
      actor_counter: Number(row.actor_counter),
      logical_ts: Number(row.logical_ts),
    },
    created_at: row.created_at,
  };
}

function fetchTableSnapshots(db: Database, adapter: TableAdapter): TableRowSnapshot[] {
  const rows = queryAll<Record<string, unknown>>(db, adapter.selectSql);

  return rows.map(row => {
    const payload = adapter.payload(row);
    return {
      rowId: adapter.rowId(row),
      rowHash: hashPayload(payload),
      payload,
    };
  });
}

function emitLocalEvent(
  db: Database,
  nodeId: string,
  input: {
    table_name: ReplicatedTable;
    row_id: string;
    op: ReplicationOp;
    payload: Record<string, unknown> | null;
  }
): void {
  const nextCounter = incrementAndGetCounter(db);
  const logicalTs = Date.now();
  const createdAt = new Date(logicalTs).toISOString();
  const eventId = `${nodeId}:${nextCounter}`;

  run(
    db,
    `
    INSERT OR REPLACE INTO cluster_events
      (event_id, actor_id, actor_counter, logical_ts, table_name, row_id, op, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      eventId,
      nodeId,
      nextCounter,
      logicalTs,
      input.table_name,
      input.row_id,
      input.op,
      input.payload ? stableStringify(input.payload) : null,
      createdAt,
    ]
  );

  run(
    db,
    `
    INSERT INTO cluster_row_versions (table_name, row_id, actor_id, actor_counter, logical_ts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(table_name, row_id) DO UPDATE SET
      actor_id = excluded.actor_id,
      actor_counter = excluded.actor_counter,
      logical_ts = excluded.logical_ts
  `,
    [input.table_name, input.row_id, nodeId, nextCounter, logicalTs]
  );
}

function incrementAndGetCounter(db: Database): number {
  run(
    db,
    'UPDATE cluster_state SET event_counter = event_counter + 1, updated_at = ? WHERE id = 1',
    [new Date().toISOString()]
  );

  const state = queryOne<{ event_counter: number }>(
    db,
    'SELECT event_counter FROM cluster_state WHERE id = 1'
  );

  return Number(state?.event_counter || 0);
}

function setRowHash(db: Database, table: ReplicatedTable, rowId: string, rowHash: string): void {
  run(
    db,
    `
    INSERT INTO cluster_row_hashes (table_name, row_id, row_hash)
    VALUES (?, ?, ?)
    ON CONFLICT(table_name, row_id) DO UPDATE SET row_hash = excluded.row_hash
  `,
    [table, rowId, rowHash]
  );
}

function splitDependencyRowId(rowId: string): [string, string] {
  const idx = rowId.indexOf('::');
  if (idx === -1) return [rowId, ''];
  return [rowId.slice(0, idx), rowId.slice(idx + 2)];
}

function toAgentLogPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    agent_id: asString(row.agent_id),
    story_id: asNullableString(row.story_id),
    event_type: asString(row.event_type),
    status: asNullableString(row.status),
    message: asNullableString(row.message),
    metadata: asNullableString(row.metadata),
    timestamp: asString(row.timestamp),
  };
}

function deleteAgentLogByRowId(db: Database, rowId: string): void {
  const rows = queryAll<Record<string, unknown>>(
    db,
    'SELECT id, agent_id, story_id, event_type, status, message, metadata, timestamp FROM agent_logs'
  );

  for (const row of rows) {
    const payload = toAgentLogPayload(row);
    if (hashPayload(payload) !== rowId) continue;
    run(db, 'DELETE FROM agent_logs WHERE id = ?', [asNumber(row.id)]);
    break;
  }
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
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = sortKeys(obj[key]);
    }
    return result;
  }

  return value;
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = asNumber(value);
  return Number.isFinite(num) ? num : null;
}
