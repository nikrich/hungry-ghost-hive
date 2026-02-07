import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { queryAll, queryOne, run } from '../db/client.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { RaftMetadataStore } from './raft-store.js';
import {
  applyRemoteEvents,
  ensureClusterTables,
  getDeltaEvents,
  getVersionVector,
  mergeSimilarStories,
  scanLocalChanges,
  type ClusterEvent,
} from './replication.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('distributed replication primitives', () => {
  it('initializes cluster tables and state for a node', async () => {
    const db = await createTestDatabase();

    ensureClusterTables(db, 'node-a');

    const state = queryOne<{ node_id: string; event_counter: number }>(
      db,
      'SELECT node_id, event_counter FROM cluster_state WHERE id = 1'
    );

    expect(state?.node_id).toBe('node-a');
    expect(state?.event_counter).toBe(0);

    db.close();
  });

  it('updates cluster_state.node_id when ensureClusterTables runs again', async () => {
    const db = await createTestDatabase();

    ensureClusterTables(db, 'node-a');
    ensureClusterTables(db, 'node-b');

    const state = queryOne<{ node_id: string }>(
      db,
      'SELECT node_id FROM cluster_state WHERE id = 1'
    );
    expect(state?.node_id).toBe('node-b');

    db.close();
  });

  it('returns empty version vector when no events exist', async () => {
    const db = await createTestDatabase();
    ensureClusterTables(db, 'node-a');

    expect(getVersionVector(db)).toEqual({});

    db.close();
  });

  it('emits insert and update events while incrementing version vector counters', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    run(
      db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES ('team-1', 'https://example.com/a.git', 'repos/a', 'alpha', ?)
    `,
      [now]
    );

    const first = scanLocalChanges(db, 'node-a');
    const second = scanLocalChanges(db, 'node-a');
    run(db, `UPDATE teams SET name = 'alpha-updated' WHERE id = 'team-1'`);
    const third = scanLocalChanges(db, 'node-a');
    const vv = getVersionVector(db);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(third).toBe(1);
    expect(vv['node-a']).toBe(2);

    db.close();
  });

  it('emits delete events when previously-known rows disappear', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    run(
      db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES ('team-del', 'https://example.com/a.git', 'repos/a', 'alpha', ?)
    `,
      [now]
    );

    scanLocalChanges(db, 'node-a');
    run(db, `DELETE FROM teams WHERE id = 'team-del'`);
    const emitted = scanLocalChanges(db, 'node-a');
    const lastEvent = queryOne<{ op: string; row_id: string }>(
      db,
      `
      SELECT op, row_id
      FROM cluster_events
      ORDER BY actor_counter DESC
      LIMIT 1
    `
    );

    expect(emitted).toBe(1);
    expect(lastEvent?.op).toBe('delete');
    expect(lastEvent?.row_id).toBe('team-del');

    db.close();
  });

  it('returns only missing events for a provided remote version vector', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    run(
      db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES
        ('team-a', 'https://example.com/a.git', 'repos/a', 'alpha', ?),
        ('team-b', 'https://example.com/b.git', 'repos/b', 'beta', ?)
    `,
      [now, now]
    );

    scanLocalChanges(db, 'node-a');

    const all = getDeltaEvents(db, {}, 10);
    const missingAfterCounter1 = getDeltaEvents(db, { 'node-a': 1 }, 10);

    expect(all).toHaveLength(2);
    expect(missingAfterCounter1).toHaveLength(1);
    expect(missingAfterCounter1[0].version.actor_counter).toBe(2);

    db.close();
  });

  it('applies a hard limit to deltas returned for anti-entropy sync', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    run(
      db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES
        ('team-1', 'https://example.com/1.git', 'repos/1', 'one', ?),
        ('team-2', 'https://example.com/2.git', 'repos/2', 'two', ?),
        ('team-3', 'https://example.com/3.git', 'repos/3', 'three', ?)
    `,
      [now, now, now]
    );

    scanLocalChanges(db, 'node-a');

    const limited = getDeltaEvents(db, {}, 2);
    expect(limited).toHaveLength(2);

    db.close();
  });

  it('ignores events for unsupported tables', async () => {
    const db = await createTestDatabase();

    const event = buildStoryEvent({
      event_id: 'node-x:1',
      table_name: 'not_a_table' as never,
      row_id: 'x',
    });

    const applied = applyRemoteEvents(db, 'node-a', [event]);
    const count = queryOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM cluster_events');

    expect(applied).toBe(0);
    expect(count?.count).toBe(0);

    db.close();
  });

  it('applies each event_id only once (idempotent replay)', async () => {
    const db = await createTestDatabase();

    const event = buildStoryEvent({
      event_id: 'node-b:1',
      row_id: 'STORY-1',
      payload: storyPayload('STORY-1', { title: 'Auth v1' }),
    });

    const first = applyRemoteEvents(db, 'node-a', [event]);
    const second = applyRemoteEvents(db, 'node-a', [event]);
    const count = queryOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM cluster_events');

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(count?.count).toBe(1);

    db.close();
  });

  it('rejects stale row updates with lower logical timestamp', async () => {
    const db = await createTestDatabase();

    const newer = buildStoryEvent({
      event_id: 'node-b:2',
      row_id: 'STORY-1',
      payload: storyPayload('STORY-1', { title: 'New title' }),
      version: { actor_id: 'node-b', actor_counter: 2, logical_ts: 2000 },
    });
    const stale = buildStoryEvent({
      event_id: 'node-a:1',
      row_id: 'STORY-1',
      payload: storyPayload('STORY-1', { title: 'Old title' }),
      version: { actor_id: 'node-a', actor_counter: 1, logical_ts: 1000 },
    });

    applyRemoteEvents(db, 'node-a', [newer]);
    const appliedStale = applyRemoteEvents(db, 'node-a', [stale]);
    const story = queryOne<{ title: string }>(db, `SELECT title FROM stories WHERE id = 'STORY-1'`);

    expect(appliedStale).toBe(0);
    expect(story?.title).toBe('New title');

    db.close();
  });

  it('breaks same-timestamp ties by actor_id deterministically', async () => {
    const db = await createTestDatabase();
    const logicalTs = 5000;

    const fromA = buildStoryEvent({
      event_id: 'node-a:1',
      row_id: 'STORY-TIE-A',
      payload: storyPayload('STORY-TIE-A', { title: 'From actor a' }),
      version: { actor_id: 'node-a', actor_counter: 1, logical_ts: logicalTs },
    });
    const fromZ = buildStoryEvent({
      event_id: 'node-z:1',
      row_id: 'STORY-TIE-A',
      payload: storyPayload('STORY-TIE-A', { title: 'From actor z' }),
      version: { actor_id: 'node-z', actor_counter: 1, logical_ts: logicalTs },
    });

    const applied = applyRemoteEvents(db, 'node-local', [fromZ, fromA]);
    const story = queryOne<{ title: string }>(
      db,
      `SELECT title FROM stories WHERE id = 'STORY-TIE-A'`
    );

    expect(applied).toBe(2);
    expect(story?.title).toBe('From actor z');

    db.close();
  });

  it('breaks same-actor same-timestamp ties by actor_counter', async () => {
    const db = await createTestDatabase();
    const logicalTs = 6000;

    const counter1 = buildStoryEvent({
      event_id: 'node-a:1',
      row_id: 'STORY-TIE-C',
      payload: storyPayload('STORY-TIE-C', { title: 'Counter 1' }),
      version: { actor_id: 'node-a', actor_counter: 1, logical_ts: logicalTs },
    });
    const counter2 = buildStoryEvent({
      event_id: 'node-a:2',
      row_id: 'STORY-TIE-C',
      payload: storyPayload('STORY-TIE-C', { title: 'Counter 2' }),
      version: { actor_id: 'node-a', actor_counter: 2, logical_ts: logicalTs },
    });

    const applied = applyRemoteEvents(db, 'node-local', [counter2, counter1]);
    const story = queryOne<{ title: string }>(
      db,
      `SELECT title FROM stories WHERE id = 'STORY-TIE-C'`
    );

    expect(applied).toBe(2);
    expect(story?.title).toBe('Counter 2');

    db.close();
  });
});

describe('distributed story merge behavior', () => {
  it('does not merge similar stories from different teams', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    run(
      db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES
        ('TEAM-A', 'https://example.com/a.git', 'repos/a', 'A', ?),
        ('TEAM-B', 'https://example.com/b.git', 'repos/b', 'B', ?)
    `,
      [now, now]
    );

    insertStoryRow(db, 'STORY-TA', {
      team_id: 'TEAM-A',
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce flow',
    });
    insertStoryRow(db, 'STORY-TB', {
      team_id: 'TEAM-B',
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce flow',
    });

    const merged = mergeSimilarStories(db, 0.8);
    const ids = queryAll<{ id: string }>(db, 'SELECT id FROM stories ORDER BY id').map(
      row => row.id
    );

    expect(merged).toBe(0);
    expect(ids).toEqual(['STORY-TA', 'STORY-TB']);

    db.close();
  });

  it('does not merge similar stories from different requirements', async () => {
    const db = await createTestDatabase();

    run(
      db,
      `
      INSERT INTO requirements (id, title, description, submitted_by, status, created_at)
      VALUES
        ('REQ-1', 'R1', 'one', 'human', 'planned', ?),
        ('REQ-2', 'R2', 'two', 'human', 'planned', ?)
    `,
      [new Date().toISOString(), new Date().toISOString()]
    );

    insertStoryRow(db, 'STORY-R1', {
      requirement_id: 'REQ-1',
      title: 'Add telemetry pipeline',
      description: 'Add telemetry events and sinks',
    });
    insertStoryRow(db, 'STORY-R2', {
      requirement_id: 'REQ-2',
      title: 'Add telemetry pipeline',
      description: 'Add telemetry events and sinks',
    });

    const merged = mergeSimilarStories(db, 0.8);
    const ids = queryAll<{ id: string }>(db, 'SELECT id FROM stories ORDER BY id').map(
      row => row.id
    );

    expect(merged).toBe(0);
    expect(ids).toEqual(['STORY-R1', 'STORY-R2']);

    db.close();
  });

  it('merges connected duplicate groups into lexicographically-smallest canonical story', async () => {
    const db = await createTestDatabase();

    insertStoryRow(db, 'STORY-300', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce flow',
    });
    insertStoryRow(db, 'STORY-100', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce',
    });
    insertStoryRow(db, 'STORY-200', {
      title: 'Implement OAuth Login flow',
      description: 'Implement oauth2 login with pkce flow and callback',
    });

    const merged = mergeSimilarStories(db, 0.45);
    const ids = queryAll<{ id: string }>(db, 'SELECT id FROM stories ORDER BY id').map(
      row => row.id
    );

    expect(merged).toBe(2);
    expect(ids).toEqual(['STORY-100']);

    db.close();
  });

  it('rebinds references to canonical story during merge', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    insertStoryRow(db, 'STORY-CAN', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce flow',
    });
    insertStoryRow(db, 'STORY-DUP', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce',
    });
    insertStoryRow(db, 'STORY-DEP', {
      title: 'Telemetry ingestion pipeline',
      description: 'Ingest event streams into long-term analytics storage',
    });
    insertStoryRow(db, 'STORY-ROOT', {
      title: 'Billing PDF export service',
      description: 'Generate downloadable invoice PDFs for enterprise customers',
    });

    run(
      db,
      `
      INSERT INTO agents (id, type, status, current_story_id, created_at, updated_at)
      VALUES ('agent-1', 'senior', 'working', 'STORY-DUP', ?, ?)
    `,
      [now, now]
    );
    run(
      db,
      `
      INSERT INTO pull_requests (id, story_id, team_id, branch_name, status, created_at, updated_at)
      VALUES ('PR-1', 'STORY-DUP', NULL, 'feature/story-dup', 'queued', ?, ?)
    `,
      [now, now]
    );
    run(
      db,
      `
      INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason, status, created_at)
      VALUES ('ESC-1', 'STORY-DUP', 'agent-1', NULL, 'blocked', 'pending', ?)
    `,
      [now]
    );
    run(
      db,
      `
      INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, timestamp)
      VALUES ('agent-1', 'STORY-DUP', 'INFO', 'working', 'Working duplicate story', ?)
    `,
      [now]
    );
    run(
      db,
      `
      INSERT INTO story_dependencies (story_id, depends_on_story_id)
      VALUES ('STORY-DUP', 'STORY-DEP'), ('STORY-ROOT', 'STORY-DUP')
    `
    );

    const merged = mergeSimilarStories(db, 0.8);

    const prStory = queryOne<{ story_id: string }>(
      db,
      `SELECT story_id FROM pull_requests WHERE id = 'PR-1'`
    );
    const escStory = queryOne<{ story_id: string }>(
      db,
      `SELECT story_id FROM escalations WHERE id = 'ESC-1'`
    );
    const logStory = queryOne<{ story_id: string }>(db, `SELECT story_id FROM agent_logs LIMIT 1`);
    const agentStory = queryOne<{ current_story_id: string }>(
      db,
      `SELECT current_story_id FROM agents WHERE id = 'agent-1'`
    );
    const mergeRecord = queryOne<{ duplicate_story_id: string; canonical_story_id: string }>(
      db,
      `SELECT duplicate_story_id, canonical_story_id FROM cluster_story_merges WHERE duplicate_story_id = 'STORY-DUP'`
    );
    const dupRefs = queryOne<{ count: number }>(
      db,
      `
      SELECT COUNT(*) as count
      FROM story_dependencies
      WHERE story_id = 'STORY-DUP' OR depends_on_story_id = 'STORY-DUP'
    `
    );
    const selfRefs = queryOne<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM story_dependencies WHERE story_id = depends_on_story_id`
    );

    expect(merged).toBe(1);
    expect(prStory?.story_id).toBe('STORY-CAN');
    expect(escStory?.story_id).toBe('STORY-CAN');
    expect(logStory?.story_id).toBe('STORY-CAN');
    expect(agentStory?.current_story_id).toBe('STORY-CAN');
    expect(mergeRecord).toEqual({
      duplicate_story_id: 'STORY-DUP',
      canonical_story_id: 'STORY-CAN',
    });
    expect(dupRefs?.count).toBe(0);
    expect(selfRefs?.count).toBe(0);

    db.close();
  });

  it('respects similarity thresholds and keeps weak matches separate', async () => {
    const db = await createTestDatabase();

    insertStoryRow(db, 'STORY-S1', {
      title: 'Improve auth',
      description: 'Improve authentication flow',
    });
    insertStoryRow(db, 'STORY-S2', {
      title: 'Improve auth metrics',
      description: 'Add metrics around auth flow and events',
    });

    const merged = mergeSimilarStories(db, 0.95);
    const ids = queryAll<{ id: string }>(db, 'SELECT id FROM stories ORDER BY id').map(
      row => row.id
    );

    expect(merged).toBe(0);
    expect(ids).toEqual(['STORY-S1', 'STORY-S2']);

    db.close();
  });

  it('skips re-merging duplicate IDs already recorded in merge history', async () => {
    const db = await createTestDatabase();

    insertStoryRow(db, 'STORY-001', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce flow',
    });
    insertStoryRow(db, 'STORY-002', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce',
    });

    const firstMerge = mergeSimilarStories(db, 0.8);
    expect(firstMerge).toBe(1);

    insertStoryRow(db, 'STORY-002', {
      title: 'Implement OAuth Login',
      description: 'Implement oauth2 login with pkce',
    });

    const secondMerge = mergeSimilarStories(db, 0.8);
    const ids = queryAll<{ id: string }>(db, 'SELECT id FROM stories ORDER BY id').map(
      row => row.id
    );

    expect(secondMerge).toBe(0);
    expect(ids).toEqual(['STORY-001', 'STORY-002']);

    db.close();
  });
});

describe('durable raft metadata store', () => {
  it('creates default state and persists appendEntry index metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-store-'));
    tempDirs.push(dir);

    const store = new RaftMetadataStore({
      clusterDir: dir,
      nodeId: 'node-raft',
    });

    const initial = store.getState();
    expect(initial.current_term).toBe(0);
    expect(initial.last_log_index).toBe(0);

    store.setState({ current_term: 3, voted_for: 'node-raft', leader_id: 'node-raft' });
    const entry = store.appendEntry({
      type: 'runtime',
      metadata: { event: 'test_append' },
    });
    const updated = store.getState();

    expect(entry.index).toBe(1);
    expect(updated.current_term).toBe(3);
    expect(updated.last_log_index).toBe(1);
    expect(updated.commit_index).toBe(1);
    expect(updated.last_applied).toBe(1);

    expect(existsSync(join(dir, 'raft-state.json'))).toBe(true);
    expect(existsSync(join(dir, 'raft-log.ndjson'))).toBe(true);
  });

  it('restores persisted events after restart and ignores malformed log lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-raft-store-'));
    tempDirs.push(dir);

    const first = new RaftMetadataStore({
      clusterDir: dir,
      nodeId: 'node-raft',
    });
    first.setState({ current_term: 7, leader_id: 'leader-1' });

    const events: ClusterEvent[] = [
      buildStoryEvent({
        event_id: 'node-b:2',
        row_id: 'STORY-B',
        version: { actor_id: 'node-b', actor_counter: 2, logical_ts: 2000 },
      }),
      buildStoryEvent({
        event_id: 'node-a:1',
        row_id: 'STORY-A',
        version: { actor_id: 'node-a', actor_counter: 1, logical_ts: 1000 },
      }),
      buildStoryEvent({
        event_id: 'node-a:1',
        row_id: 'STORY-A',
        version: { actor_id: 'node-a', actor_counter: 1, logical_ts: 1000 },
      }),
    ];

    const appended = first.appendClusterEvents(events, 7);
    expect(appended).toBe(2);

    appendFileSync(join(dir, 'raft-log.ndjson'), 'this-is-not-json\n', 'utf-8');

    const second = new RaftMetadataStore({
      clusterDir: dir,
      nodeId: 'node-raft',
    });
    const restored = second.getState();
    const logContent = readFileSync(join(dir, 'raft-log.ndjson'), 'utf-8');
    const deduped = second.appendClusterEvents(events, 7);

    expect(restored.current_term).toBe(7);
    expect(restored.leader_id).toBe('leader-1');
    expect(restored.last_log_index).toBeGreaterThanOrEqual(2);
    expect(second.hasEvent('node-a:1')).toBe(true);
    expect(second.hasEvent('node-b:2')).toBe(true);
    expect(logContent).toContain('this-is-not-json');
    expect(deduped).toBe(0);
  });
});

function storyPayload(
  id: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id,
    requirement_id: null,
    team_id: null,
    title: `Story ${id}`,
    description: `Description ${id}`,
    acceptance_criteria: null,
    complexity_score: null,
    story_points: null,
    status: 'planned',
    assigned_agent_id: null,
    branch_name: null,
    pr_url: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function buildStoryEvent(input: {
  event_id: string;
  table_name?: ClusterEvent['table_name'];
  row_id: string;
  op?: ClusterEvent['op'];
  payload?: Record<string, unknown> | null;
  version?: ClusterEvent['version'];
}): ClusterEvent {
  return {
    event_id: input.event_id,
    table_name: input.table_name || 'stories',
    row_id: input.row_id,
    op: input.op || 'upsert',
    payload: input.payload === undefined ? storyPayload(input.row_id) : input.payload,
    version:
      input.version ||
      ({
        actor_id: 'node-a',
        actor_counter: 1,
        logical_ts: Date.now(),
      } satisfies ClusterEvent['version']),
    created_at: new Date().toISOString(),
  };
}

function insertStoryRow(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
  id: string,
  overrides: Partial<Record<string, unknown>> = {}
): void {
  const payload = storyPayload(id, overrides);

  run(
    db,
    `
    INSERT INTO stories (
      id, requirement_id, team_id, title, description, acceptance_criteria,
      complexity_score, story_points, status, assigned_agent_id,
      branch_name, pr_url, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      payload.id,
      payload.requirement_id,
      payload.team_id,
      payload.title,
      payload.description,
      payload.acceptance_criteria,
      payload.complexity_score,
      payload.story_points,
      payload.status,
      payload.assigned_agent_id,
      payload.branch_name,
      payload.pr_url,
      payload.created_at,
      payload.updated_at,
    ]
  );
}
