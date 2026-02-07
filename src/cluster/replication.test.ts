import { describe, expect, it } from 'vitest';
import { queryOne, run } from '../db/client.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import {
  applyRemoteEvents,
  getDeltaEvents,
  getVersionVector,
  mergeSimilarStories,
  scanLocalChanges,
  type ClusterEvent,
} from './replication.js';

describe('cluster replication', () => {
  it('detects local row changes and emits deterministic events', async () => {
    const db = await createTestDatabase();

    run(
      db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES ('team-1', 'https://example.com/a.git', 'repos/a', 'alpha', ?)
    `,
      [new Date().toISOString()]
    );

    const first = scanLocalChanges(db, 'node-a');
    const second = scanLocalChanges(db, 'node-a');

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);

    run(db, `UPDATE teams SET name = 'alpha-updated' WHERE id = 'team-1'`);
    const third = scanLocalChanges(db, 'node-a');

    expect(third).toBe(1);

    const vv = getVersionVector(db);
    expect(vv['node-a']).toBeGreaterThanOrEqual(2);

    db.close();
  });

  it('applies remote delta events into another node', async () => {
    const sourceDb = await createTestDatabase();
    const targetDb = await createTestDatabase();

    run(
      sourceDb,
      `
      INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
      VALUES ('STORY-AAA111', NULL, NULL, 'Add auth', 'Add oauth login flow', 'planned', ?, ?)
    `,
      [new Date().toISOString(), new Date().toISOString()]
    );

    scanLocalChanges(sourceDb, 'node-a');
    const delta = getDeltaEvents(sourceDb, {}, 100);

    const applied = applyRemoteEvents(targetDb, 'node-b', delta);
    expect(applied).toBeGreaterThan(0);

    const story = queryOne<{ id: string; title: string }>(
      targetDb,
      `SELECT id, title FROM stories WHERE id = 'STORY-AAA111'`
    );
    expect(story?.id).toBe('STORY-AAA111');
    expect(story?.title).toBe('Add auth');

    sourceDb.close();
    targetDb.close();
  });

  it('replicates requirements including godmode flag', async () => {
    const sourceDb = await createTestDatabase();
    const targetDb = await createTestDatabase();

    run(
      sourceDb,
      `
      INSERT INTO requirements (id, title, description, submitted_by, status, godmode, created_at)
      VALUES ('REQ-GODMODE', 'Godmode Req', 'High-priority execution', 'human', 'planning', 1, ?)
    `,
      [new Date().toISOString()]
    );

    scanLocalChanges(sourceDb, 'node-a');
    const delta = getDeltaEvents(sourceDb, {}, 100);
    const applied = applyRemoteEvents(targetDb, 'node-b', delta);

    expect(applied).toBeGreaterThan(0);

    const requirement = queryOne<{ id: string; godmode: number }>(
      targetDb,
      `SELECT id, godmode FROM requirements WHERE id = 'REQ-GODMODE'`
    );
    expect(requirement?.id).toBe('REQ-GODMODE');
    expect(requirement?.godmode).toBe(1);

    sourceDb.close();
    targetDb.close();
  });

  it('preserves existing godmode when applying legacy requirement events without godmode field', async () => {
    const db = await createTestDatabase();
    const now = new Date().toISOString();

    run(
      db,
      `
      INSERT INTO requirements (id, title, description, submitted_by, status, godmode, created_at)
      VALUES ('REQ-LEGACY', 'Original', 'Original desc', 'human', 'planning', 1, ?)
    `,
      [now]
    );

    const legacyEvent: ClusterEvent = {
      event_id: 'node-old:42',
      table_name: 'requirements',
      row_id: 'REQ-LEGACY',
      op: 'upsert',
      payload: {
        id: 'REQ-LEGACY',
        title: 'Updated by legacy node',
        description: 'Updated desc',
        submitted_by: 'human',
        status: 'in_progress',
        created_at: now,
      },
      version: {
        actor_id: 'node-old',
        actor_counter: 42,
        logical_ts: Date.now(),
      },
      created_at: now,
    };

    const applied = applyRemoteEvents(db, 'node-local', [legacyEvent]);
    expect(applied).toBe(1);

    const requirement = queryOne<{ title: string; status: string; godmode: number }>(
      db,
      `SELECT title, status, godmode FROM requirements WHERE id = 'REQ-LEGACY'`
    );
    expect(requirement?.title).toBe('Updated by legacy node');
    expect(requirement?.status).toBe('in_progress');
    expect(requirement?.godmode).toBe(1);

    db.close();
  });

  it('merges similar duplicate stories into a canonical story', async () => {
    const db = await createTestDatabase();

    run(
      db,
      `
      INSERT INTO stories (id, requirement_id, team_id, title, description, status, created_at, updated_at)
      VALUES
        ('STORY-ZZZ999', NULL, NULL, 'Implement OAuth Login', 'Implement oauth2 login with PKCE', 'planned', ?, ?),
        ('STORY-AAA001', NULL, NULL, 'Implement OAuth Login', 'Implement oauth2 login with PKCE flow', 'planned', ?, ?)
    `,
      [
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    const merged = mergeSimilarStories(db, 0.8);
    expect(merged).toBe(1);

    const stories = db.exec(`SELECT id FROM stories ORDER BY id`);
    const ids = stories[0]?.values.map(v => String(v[0])) || [];
    expect(ids).toEqual(['STORY-AAA001']);

    db.close();
  });
});
