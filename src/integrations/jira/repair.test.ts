// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import { queryAll, run } from '../../db/client.js';
import { createStory, getStoryById } from '../../db/queries/stories.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import { repairMissedAssignmentHooks } from './sync.js';

// Mock Jira client, comments, issues, stories, and transitions modules
vi.mock('./client.js');
vi.mock('./comments.js');
vi.mock('./issues.js');
vi.mock('./stories.js');
vi.mock('./transitions.js');

describe('repairMissedAssignmentHooks', () => {
  let db: Database;
  let envDir: string;

  const baseConfig: JiraConfig = {
    project_key: 'TEST',
    site_url: 'https://test.atlassian.net',
    story_type: 'Story',
    subtask_type: 'Subtask',
    story_points_field: 'story_points',
    status_mapping: {
      'In Progress': 'in_progress',
    },
  };

  function createTestTokenStore(tokens?: Record<string, string>): TokenStore {
    const envPath = join(envDir, `.env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const content = tokens
      ? Object.entries(tokens)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      : '';
    writeFileSync(envPath, content);
    const store = new TokenStore(envPath);
    if (tokens) {
      for (const [key, value] of Object.entries(tokens)) {
        (store as any).tokens[key] = value;
      }
    }
    return store;
  }

  function addJiraColumnsToStories(): void {
    // The test helper schema only has jira_issue_key. Add the other Jira columns.
    const columnInfo = queryAll<{ name: string }>(db, 'PRAGMA table_info(stories)');
    const columnNames = columnInfo.map(c => c.name);

    if (!columnNames.includes('jira_issue_id')) {
      run(db, 'ALTER TABLE stories ADD COLUMN jira_issue_id TEXT');
    }
    if (!columnNames.includes('jira_project_key')) {
      run(db, 'ALTER TABLE stories ADD COLUMN jira_project_key TEXT');
    }
    if (!columnNames.includes('jira_subtask_key')) {
      run(db, 'ALTER TABLE stories ADD COLUMN jira_subtask_key TEXT');
    }
    if (!columnNames.includes('jira_subtask_id')) {
      run(db, 'ALTER TABLE stories ADD COLUMN jira_subtask_id TEXT');
    }
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-repair-test-'));
    // Create a manager agent for logging purposes
    db.run(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
    // Create a team
    db.run(
      `INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-test', 'https://github.com/test/test.git', 'repos/test', 'test-team')`
    );
    // Create a working agent
    db.run(
      `INSERT INTO agents (id, type, status, team_id, tmux_session) VALUES ('agent-senior-1', 'senior', 'working', 'team-test', 'hive-senior-test-team')`
    );
    // Add missing Jira columns to test schema
    addJiraColumnsToStories();
  });

  it('returns 0 when no stories need repair', async () => {
    const tokenStore = createTestTokenStore();
    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(0);
  });

  it('skips stories that already have a subtask key', async () => {
    const story = createStory(db, {
      title: 'Already has subtask',
      description: 'Test',
    });
    run(
      db,
      `UPDATE stories SET jira_issue_key = ?, assigned_agent_id = ?, jira_subtask_key = ?, status = ? WHERE id = ?`,
      ['TEST-1', 'agent-senior-1', 'TEST-2', 'in_progress', story.id]
    );

    const tokenStore = createTestTokenStore();
    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(0);
  });

  it('skips stories without jira_issue_key', async () => {
    const story = createStory(db, {
      title: 'No Jira key',
      description: 'Test',
    });
    run(db, `UPDATE stories SET assigned_agent_id = ?, status = ? WHERE id = ?`, [
      'agent-senior-1',
      'in_progress',
      story.id,
    ]);

    const tokenStore = createTestTokenStore();
    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(0);
  });

  it('skips stories without assigned_agent_id', async () => {
    const story = createStory(db, {
      title: 'Not assigned',
      description: 'Test',
    });
    run(db, `UPDATE stories SET jira_issue_key = ?, status = ? WHERE id = ?`, [
      'TEST-1',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore();
    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(0);
  });

  it('repairs assigned story missing subtask by creating subtask and posting comment', async () => {
    const story = createStory(db, {
      title: 'Needs repair',
      description: 'Test',
    });
    run(
      db,
      `UPDATE stories SET jira_issue_key = ?, jira_project_key = ?, assigned_agent_id = ?, status = ? WHERE id = ?`,
      ['TEST-10', 'TEST', 'agent-senior-1', 'in_progress', story.id]
    );

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    // Mock createSubtask to return a subtask
    const { createSubtask } = await import('./comments.js');
    vi.mocked(createSubtask).mockResolvedValue({
      id: '20001',
      key: 'TEST-11',
      self: 'https://test.atlassian.net/rest/api/3/issue/20001',
    });

    // Mock postComment
    const { postComment } = await import('./comments.js');
    vi.mocked(postComment).mockResolvedValue(true);

    // Mock syncStoryStatusToJira (called for in_progress stories)
    const { syncStoryStatusToJira } = await import('./transitions.js');
    vi.mocked(syncStoryStatusToJira).mockResolvedValue(undefined);

    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(1);

    // Verify subtask was created with correct args
    expect(createSubtask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentIssueKey: 'TEST-10',
        projectKey: 'TEST',
        agentName: 'hive-senior-test-team',
        storyTitle: 'Needs repair',
      })
    );

    // Verify comment was posted
    expect(postComment).toHaveBeenCalledWith(
      expect.anything(),
      'TEST-10',
      'assigned',
      expect.objectContaining({
        agentName: 'hive-senior-test-team',
        subtaskKey: 'TEST-11',
      })
    );

    // Verify subtask key was persisted to DB
    const updatedStory = getStoryById(db, story.id);
    expect(updatedStory?.jira_subtask_key).toBe('TEST-11');
    expect(updatedStory?.jira_subtask_id).toBe('20001');

    // Verify status sync was called for in_progress story
    expect(syncStoryStatusToJira).toHaveBeenCalledWith(
      db,
      tokenStore,
      baseConfig,
      story.id,
      'in_progress'
    );
  });

  it('does not create duplicate subtasks when repair runs twice', async () => {
    const story = createStory(db, {
      title: 'Repair idempotency',
      description: 'Test',
    });
    run(
      db,
      `UPDATE stories SET jira_issue_key = ?, assigned_agent_id = ?, status = ? WHERE id = ?`,
      ['TEST-20', 'agent-senior-1', 'in_progress', story.id]
    );

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const { createSubtask } = await import('./comments.js');
    vi.mocked(createSubtask).mockResolvedValue({
      id: '30001',
      key: 'TEST-21',
      self: 'https://test.atlassian.net/rest/api/3/issue/30001',
    });

    const { postComment } = await import('./comments.js');
    vi.mocked(postComment).mockResolvedValue(true);

    const { syncStoryStatusToJira } = await import('./transitions.js');
    vi.mocked(syncStoryStatusToJira).mockResolvedValue(undefined);

    // First repair
    const repaired1 = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired1).toBe(1);

    // Reset mocks to track second call
    vi.mocked(createSubtask).mockClear();

    // Second repair — story now has subtask key, should be skipped
    const repaired2 = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired2).toBe(0);
    expect(createSubtask).not.toHaveBeenCalled();
  });

  it('skips merged stories', async () => {
    const story = createStory(db, {
      title: 'Merged story',
      description: 'Test',
    });
    run(
      db,
      `UPDATE stories SET jira_issue_key = ?, assigned_agent_id = ?, status = ? WHERE id = ?`,
      ['TEST-30', 'agent-senior-1', 'merged', story.id]
    );

    const tokenStore = createTestTokenStore();
    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(0);
  });

  it('handles API errors gracefully without crashing', async () => {
    const story = createStory(db, {
      title: 'Error story',
      description: 'Test',
    });
    run(
      db,
      `UPDATE stories SET jira_issue_key = ?, assigned_agent_id = ?, status = ? WHERE id = ?`,
      ['TEST-40', 'agent-senior-1', 'in_progress', story.id]
    );

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const { createSubtask } = await import('./comments.js');
    vi.mocked(createSubtask).mockRejectedValue(new Error('API Error'));

    // Should not throw
    const repaired = await repairMissedAssignmentHooks(db, tokenStore, baseConfig);
    expect(repaired).toBe(0);
  });
});
