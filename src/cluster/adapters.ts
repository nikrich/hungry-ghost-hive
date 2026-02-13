// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { run } from '../db/client.js';
import type { ReplicatedTable, StoryRecord, TableAdapter } from './types.js';
import {
  asNullableNumber,
  asNullableString,
  asString,
  deleteAgentLogByRowId,
  hashPayload,
  splitDependencyRowId,
  toAgentLogPayload,
} from './utils.js';

export const STORY_STATUS_ORDER: Array<StoryRecord['status']> = [
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

export const REPLICATED_TABLES: TableAdapter[] = [
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
      godmode: asNullableNumber(row.godmode),
      created_at: asString(row.created_at),
    }),
    upsert: (db, payload) => {
      run(
        db,
        `
        INSERT INTO requirements (id, title, description, submitted_by, status, godmode, created_at)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, 0), ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          submitted_by = excluded.submitted_by,
          status = excluded.status,
          godmode = CASE
            WHEN ? IS NULL THEN requirements.godmode
            ELSE ?
          END,
          created_at = excluded.created_at
      `,
        [
          asString(payload.id),
          asString(payload.title),
          asString(payload.description),
          asString(payload.submitted_by),
          asString(payload.status),
          asNullableNumber(payload.godmode),
          asNullableNumber(payload.godmode),
          asNullableNumber(payload.godmode),
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

export const ADAPTERS_BY_TABLE = new Map<ReplicatedTable, TableAdapter>(
  REPLICATED_TABLES.map(adapter => [adapter.table, adapter])
);
