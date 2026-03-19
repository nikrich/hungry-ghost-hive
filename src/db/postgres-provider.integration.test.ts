// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresProvider } from './postgres-provider.js';

/**
 * Integration tests for PostgresProvider.
 * Requires a real Postgres connection via HIVE_DATABASE_URL.
 * Skipped automatically when the environment variable is not set.
 */

const connectionString = process.env.HIVE_DATABASE_URL;

const describeIf = connectionString ? describe : describe.skip;

describeIf('PostgresProvider integration', () => {
  let provider: PostgresProvider;
  let workspaceId: string;

  beforeAll(async () => {
    // Run migrations once for the entire suite using a temporary provider
    const setupProvider = new PostgresProvider(connectionString!, nanoid());
    await setupProvider.runMigrations();
    await setupProvider.close();
  });

  beforeEach(async () => {
    // Each test gets a unique workspace_id for isolation
    workspaceId = `test-ws-${nanoid()}`;
    provider = new PostgresProvider(connectionString!, workspaceId);
  });

  afterEach(async () => {
    // Clean up test data for this workspace
    const pool = new pg.Pool({ connectionString: connectionString! });
    const tables = [
      'integration_sync',
      'messages',
      'pull_requests',
      'escalations',
      'agent_logs',
      'story_dependencies',
      'stories',
      'requirements',
      'agents',
      'teams',
    ];
    for (const table of tables) {
      await pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    }
    await pool.end();
    await provider.close();
  });

  afterAll(async () => {
    // Clean up migrations table entries added during tests
    // (leave schema in place for other test runs)
  });

  describe('connection and migrations', () => {
    it('should connect and respond to queries', async () => {
      await provider.testConnection();
    });

    it('should run migrations idempotently', async () => {
      // Running migrations again should not throw
      await provider.runMigrations();
      await provider.runMigrations();
    });

    it('should have created all workspace-scoped tables', async () => {
      const expectedTables = [
        'teams',
        'agents',
        'requirements',
        'stories',
        'story_dependencies',
        'agent_logs',
        'escalations',
        'pull_requests',
        'messages',
        'integration_sync',
      ];

      const pool = new pg.Pool({ connectionString: connectionString! });
      try {
        for (const table of expectedTables) {
          const { rows } = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'workspace_id'`,
            [table]
          );
          expect(rows.length, `Table ${table} should have workspace_id column`).toBe(1);
        }
      } finally {
        await pool.end();
      }
    });

    it('should have migrations table without workspace_id', async () => {
      const pool = new pg.Pool({ connectionString: connectionString! });
      try {
        const { rows } = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'migrations' AND column_name = 'workspace_id'`
        );
        expect(rows.length).toBe(0);
      } finally {
        await pool.end();
      }
    });
  });

  describe('CRUD operations with workspace_id injection', () => {
    it('should insert and query a team', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'https://github.com/test/repo.git',
        '/tmp/repo',
        'test-team',
      ]);

      const teams = await provider.queryAll<{ id: string; name: string }>(
        'SELECT id, name FROM teams'
      );
      expect(teams).toHaveLength(1);
      expect(teams[0].id).toBe('team-1');
      expect(teams[0].name).toBe('test-team');
    });

    it('should insert and queryOne a story', async () => {
      // Insert a team first (foreign key context)
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'https://github.com/test/repo.git',
        '/tmp/repo',
        'test-team',
      ]);

      await provider.run(
        `INSERT INTO stories (id, requirement_id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', 'req-1', 'team-1', 'Test Story', 'A test story', 'planned']
      );

      const story = await provider.queryOne<{ id: string; title: string; status: string }>(
        'SELECT id, title, status FROM stories WHERE id = ?',
        ['story-1']
      );
      expect(story).toBeDefined();
      expect(story!.id).toBe('story-1');
      expect(story!.title).toBe('Test Story');
      expect(story!.status).toBe('planned');
    });

    it('should update records with workspace scoping', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'https://github.com/test/repo.git',
        '/tmp/repo',
        'old-name',
      ]);

      await provider.run('UPDATE teams SET name = ? WHERE id = ?', ['new-name', 'team-1']);

      const team = await provider.queryOne<{ name: string }>(
        'SELECT name FROM teams WHERE id = ?',
        ['team-1']
      );
      expect(team!.name).toBe('new-name');
    });

    it('should delete records with workspace scoping', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-del',
        'https://github.com/test/repo.git',
        '/tmp/repo',
        'to-delete',
      ]);

      await provider.run('DELETE FROM teams WHERE id = ?', ['team-del']);

      const teams = await provider.queryAll<{ id: string }>('SELECT id FROM teams WHERE id = ?', [
        'team-del',
      ]);
      expect(teams).toHaveLength(0);
    });

    it('should return undefined for queryOne with no results', async () => {
      const result = await provider.queryOne<{ id: string }>('SELECT id FROM teams WHERE id = ?', [
        'nonexistent',
      ]);
      expect(result).toBeUndefined();
    });

    it('should return empty array for queryAll with no results', async () => {
      const results = await provider.queryAll<{ id: string }>('SELECT id FROM teams WHERE id = ?', [
        'nonexistent',
      ]);
      expect(results).toEqual([]);
    });
  });

  describe('workspace isolation (multi-tenancy)', () => {
    let otherProvider: PostgresProvider;
    let otherWorkspaceId: string;

    beforeEach(async () => {
      otherWorkspaceId = `test-ws-other-${nanoid()}`;
      otherProvider = new PostgresProvider(connectionString!, otherWorkspaceId);
    });

    afterEach(async () => {
      // Clean up the other workspace's data
      const pool = new pg.Pool({ connectionString: connectionString! });
      const tables = [
        'integration_sync',
        'messages',
        'pull_requests',
        'escalations',
        'agent_logs',
        'story_dependencies',
        'stories',
        'requirements',
        'agents',
        'teams',
      ];
      for (const table of tables) {
        await pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [otherWorkspaceId]);
      }
      await pool.end();
      await otherProvider.close();
    });

    it('should not see data from another workspace', async () => {
      // Insert into workspace A
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-ws-a',
        'https://github.com/a/repo.git',
        '/tmp/a',
        'team-a',
      ]);

      // Insert into workspace B
      await otherProvider.run(
        `INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`,
        ['team-ws-b', 'https://github.com/b/repo.git', '/tmp/b', 'team-b']
      );

      // Workspace A should only see its own team
      const teamsA = await provider.queryAll<{ id: string; name: string }>(
        'SELECT id, name FROM teams'
      );
      expect(teamsA).toHaveLength(1);
      expect(teamsA[0].id).toBe('team-ws-a');

      // Workspace B should only see its own team
      const teamsB = await otherProvider.queryAll<{ id: string; name: string }>(
        'SELECT id, name FROM teams'
      );
      expect(teamsB).toHaveLength(1);
      expect(teamsB[0].id).toBe('team-ws-b');
    });

    it('should not update data in another workspace', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-shared-id',
        'https://github.com/a/repo.git',
        '/tmp/a',
        'team-a-original',
      ]);

      await otherProvider.run(
        `INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`,
        ['team-shared-id', 'https://github.com/b/repo.git', '/tmp/b', 'team-b-original']
      );

      // Update from workspace B should not affect workspace A
      await otherProvider.run('UPDATE teams SET name = ? WHERE id = ?', [
        'team-b-updated',
        'team-shared-id',
      ]);

      const teamA = await provider.queryOne<{ name: string }>(
        'SELECT name FROM teams WHERE id = ?',
        ['team-shared-id']
      );
      expect(teamA!.name).toBe('team-a-original');

      const teamB = await otherProvider.queryOne<{ name: string }>(
        'SELECT name FROM teams WHERE id = ?',
        ['team-shared-id']
      );
      expect(teamB!.name).toBe('team-b-updated');
    });

    it('should not delete data in another workspace', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-to-keep',
        'https://github.com/a/repo.git',
        '/tmp/a',
        'keep-me',
      ]);

      await otherProvider.run(
        `INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`,
        ['team-to-keep', 'https://github.com/b/repo.git', '/tmp/b', 'delete-me']
      );

      // Delete from workspace B should not affect workspace A
      await otherProvider.run('DELETE FROM teams WHERE id = ?', ['team-to-keep']);

      const teamA = await provider.queryOne<{ id: string }>('SELECT id FROM teams WHERE id = ?', [
        'team-to-keep',
      ]);
      expect(teamA).toBeDefined();

      const teamB = await otherProvider.queryOne<{ id: string }>(
        'SELECT id FROM teams WHERE id = ?',
        ['team-to-keep']
      );
      expect(teamB).toBeUndefined();
    });

    it('should isolate stories across workspaces', async () => {
      await provider.run(
        `INSERT INTO stories (id, title, description, status) VALUES (?, ?, ?, ?)`,
        ['story-iso', 'Story in A', 'Desc A', 'planned']
      );

      await otherProvider.run(
        `INSERT INTO stories (id, title, description, status) VALUES (?, ?, ?, ?)`,
        ['story-iso', 'Story in B', 'Desc B', 'in_progress']
      );

      const storyA = await provider.queryOne<{ title: string; status: string }>(
        'SELECT title, status FROM stories WHERE id = ?',
        ['story-iso']
      );
      expect(storyA!.title).toBe('Story in A');
      expect(storyA!.status).toBe('planned');

      const storyB = await otherProvider.queryOne<{ title: string; status: string }>(
        'SELECT title, status FROM stories WHERE id = ?',
        ['story-iso']
      );
      expect(storyB!.title).toBe('Story in B');
      expect(storyB!.status).toBe('in_progress');
    });
  });

  describe('all workspace-scoped tables', () => {
    it('should insert and query agents', async () => {
      await provider.run(`INSERT INTO agents (id, type, status) VALUES (?, ?, ?)`, [
        'agent-1',
        'senior',
        'idle',
      ]);

      const agents = await provider.queryAll<{ id: string; type: string }>(
        'SELECT id, type FROM agents'
      );
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should insert and query requirements', async () => {
      await provider.run(`INSERT INTO requirements (id, title, description) VALUES (?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Some description',
      ]);

      const reqs = await provider.queryAll<{ id: string; title: string }>(
        'SELECT id, title FROM requirements'
      );
      expect(reqs).toHaveLength(1);
      expect(reqs[0].title).toBe('Test Requirement');
    });

    it('should insert and query escalations', async () => {
      await provider.run(`INSERT INTO escalations (id, reason, status) VALUES (?, ?, ?)`, [
        'esc-1',
        'Need help',
        'pending',
      ]);

      const escs = await provider.queryAll<{ id: string; reason: string }>(
        'SELECT id, reason FROM escalations'
      );
      expect(escs).toHaveLength(1);
      expect(escs[0].reason).toBe('Need help');
    });

    it('should insert and query pull_requests', async () => {
      await provider.run(`INSERT INTO pull_requests (id, branch_name, status) VALUES (?, ?, ?)`, [
        'pr-1',
        'feature/test',
        'queued',
      ]);

      const prs = await provider.queryAll<{ id: string; branch_name: string }>(
        'SELECT id, branch_name FROM pull_requests'
      );
      expect(prs).toHaveLength(1);
      expect(prs[0].branch_name).toBe('feature/test');
    });

    it('should insert and query messages', async () => {
      await provider.run(
        `INSERT INTO messages (id, from_session, to_session, body) VALUES (?, ?, ?, ?)`,
        ['msg-1', 'agent-a', 'agent-b', 'Hello']
      );

      const msgs = await provider.queryAll<{ id: string; body: string }>(
        'SELECT id, body FROM messages'
      );
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toBe('Hello');
    });

    it('should insert and query agent_logs', async () => {
      await provider.run(
        `INSERT INTO agent_logs (agent_id, event_type, message) VALUES (?, ?, ?)`,
        ['agent-1', 'status_change', 'Started working']
      );

      const logs = await provider.queryAll<{ agent_id: string; event_type: string }>(
        'SELECT agent_id, event_type FROM agent_logs'
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].event_type).toBe('status_change');
    });

    it('should insert and query story_dependencies', async () => {
      // Insert prerequisite stories first
      await provider.run(
        `INSERT INTO stories (id, title, description, status) VALUES (?, ?, ?, ?)`,
        ['story-dep-a', 'Story A', 'Desc', 'planned']
      );
      await provider.run(
        `INSERT INTO stories (id, title, description, status) VALUES (?, ?, ?, ?)`,
        ['story-dep-b', 'Story B', 'Desc', 'planned']
      );

      await provider.run(
        `INSERT INTO story_dependencies (story_id, depends_on_story_id) VALUES (?, ?)`,
        ['story-dep-b', 'story-dep-a']
      );

      const deps = await provider.queryAll<{ story_id: string; depends_on_story_id: string }>(
        'SELECT story_id, depends_on_story_id FROM story_dependencies'
      );
      expect(deps).toHaveLength(1);
      expect(deps[0].story_id).toBe('story-dep-b');
      expect(deps[0].depends_on_story_id).toBe('story-dep-a');
    });

    it('should insert and query integration_sync', async () => {
      await provider.run(
        `INSERT INTO integration_sync (id, entity_type, entity_id, provider, external_id) VALUES (?, ?, ?, ?, ?)`,
        ['sync-1', 'story', 'story-1', 'jira', 'JIRA-123']
      );

      const syncs = await provider.queryAll<{ id: string; external_id: string }>(
        'SELECT id, external_id FROM integration_sync'
      );
      expect(syncs).toHaveLength(1);
      expect(syncs[0].external_id).toBe('JIRA-123');
    });
  });

  describe('transactions', () => {
    it('should commit successful transactions', async () => {
      await provider.withTransaction(async () => {
        await provider.run(
          `INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`,
          ['team-tx-1', 'https://github.com/tx/repo.git', '/tmp/tx', 'tx-team']
        );
      });

      const team = await provider.queryOne<{ id: string }>('SELECT id FROM teams WHERE id = ?', [
        'team-tx-1',
      ]);
      expect(team).toBeDefined();
    });

    it('should rollback failed transactions', async () => {
      try {
        await provider.withTransaction(async () => {
          await provider.run(
            `INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`,
            ['team-tx-fail', 'https://github.com/tx/repo.git', '/tmp/tx', 'tx-team']
          );
          throw new Error('Intentional failure');
        });
      } catch {
        // Expected
      }

      const team = await provider.queryOne<{ id: string }>('SELECT id FROM teams WHERE id = ?', [
        'team-tx-fail',
      ]);
      expect(team).toBeUndefined();
    });
  });

  describe('query patterns', () => {
    it('should handle SELECT with ORDER BY', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-z',
        'https://github.com/z/repo.git',
        '/tmp/z',
        'z-team',
      ]);
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-a',
        'https://github.com/a/repo.git',
        '/tmp/a',
        'a-team',
      ]);

      const teams = await provider.queryAll<{ name: string }>(
        'SELECT name FROM teams ORDER BY name ASC'
      );
      expect(teams).toHaveLength(2);
      expect(teams[0].name).toBe('a-team');
      expect(teams[1].name).toBe('z-team');
    });

    it('should handle SELECT with LIMIT', async () => {
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-1',
        'https://github.com/1/repo.git',
        '/tmp/1',
        'team-1',
      ]);
      await provider.run(`INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
        'team-2',
        'https://github.com/2/repo.git',
        '/tmp/2',
        'team-2',
      ]);

      const teams = await provider.queryAll<{ name: string }>(
        'SELECT name FROM teams ORDER BY name LIMIT 1'
      );
      expect(teams).toHaveLength(1);
    });

    it('should handle queries with multiple WHERE conditions', async () => {
      await provider.run(
        `INSERT INTO stories (id, title, description, status, team_id) VALUES (?, ?, ?, ?, ?)`,
        ['story-q1', 'Query Test', 'Desc', 'planned', 'team-1']
      );
      await provider.run(
        `INSERT INTO stories (id, title, description, status, team_id) VALUES (?, ?, ?, ?, ?)`,
        ['story-q2', 'Another', 'Desc', 'in_progress', 'team-1']
      );

      const stories = await provider.queryAll<{ id: string }>(
        'SELECT id FROM stories WHERE status = ? AND team_id = ?',
        ['planned', 'team-1']
      );
      expect(stories).toHaveLength(1);
      expect(stories[0].id).toBe('story-q1');
    });
  });

  describe('getWorkspaceId', () => {
    it('should return the workspace_id used to construct the provider', () => {
      expect(provider.getWorkspaceId()).toBe(workspaceId);
    });
  });
});
