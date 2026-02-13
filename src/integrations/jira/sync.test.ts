// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import { run } from '../../db/client.js';
import { createStory, getStoryById } from '../../db/queries/stories.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import {
  isForwardTransition,
  jiraStatusToHiveStatus,
  syncJiraStatusesToHive,
  syncUnsyncedStoriesToJira,
} from './sync.js';
import type { JiraIssue } from './types.js';

// Mock Jira client and issues module
vi.mock('./client.js');
vi.mock('./issues.js');
vi.mock('./stories.js');

describe('jiraStatusToHiveStatus', () => {
  it('maps Jira status to Hive status (case-insensitive)', () => {
    const mapping = {
      'To Do': 'planned',
      'In Progress': 'in_progress',
      Done: 'merged',
    };

    expect(jiraStatusToHiveStatus('To Do', mapping)).toBe('planned');
    expect(jiraStatusToHiveStatus('to do', mapping)).toBe('planned');
    expect(jiraStatusToHiveStatus('TO DO', mapping)).toBe('planned');
    expect(jiraStatusToHiveStatus('In Progress', mapping)).toBe('in_progress');
    expect(jiraStatusToHiveStatus('Done', mapping)).toBe('merged');
  });

  it('returns null for unmapped status', () => {
    const mapping = {
      'To Do': 'planned',
    };

    expect(jiraStatusToHiveStatus('Unknown Status', mapping)).toBeNull();
  });

  it('returns null for empty mapping', () => {
    expect(jiraStatusToHiveStatus('To Do', {})).toBeNull();
  });
});

describe('isForwardTransition', () => {
  it('allows forward transitions', () => {
    expect(isForwardTransition('draft', 'estimated')).toBe(true);
    expect(isForwardTransition('estimated', 'planned')).toBe(true);
    expect(isForwardTransition('planned', 'in_progress')).toBe(true);
    expect(isForwardTransition('in_progress', 'review')).toBe(true);
    expect(isForwardTransition('review', 'pr_submitted')).toBe(true);
    expect(isForwardTransition('pr_submitted', 'qa')).toBe(true);
    expect(isForwardTransition('qa', 'merged')).toBe(true);
  });

  it('allows same-status (no-op)', () => {
    expect(isForwardTransition('planned', 'planned')).toBe(true);
    expect(isForwardTransition('in_progress', 'in_progress')).toBe(true);
  });

  it('prevents backward transitions', () => {
    expect(isForwardTransition('in_progress', 'planned')).toBe(false);
    expect(isForwardTransition('in_progress', 'draft')).toBe(false);
    expect(isForwardTransition('review', 'planned')).toBe(false);
    expect(isForwardTransition('merged', 'planned')).toBe(false);
    expect(isForwardTransition('qa', 'planned')).toBe(false);
  });

  it('handles qa_failed ordering correctly', () => {
    // qa_failed (order=4) same as review — so it's a lateral move from review
    expect(isForwardTransition('review', 'qa_failed')).toBe(true);
    // qa_failed is forward from in_progress
    expect(isForwardTransition('in_progress', 'qa_failed')).toBe(true);
    // qa_failed is backward from qa — blocked (manager handles this directly)
    expect(isForwardTransition('qa', 'qa_failed')).toBe(false);
  });
});

describe('syncJiraStatusesToHive', () => {
  let db: Database;
  let envDir: string;

  const baseConfig: JiraConfig = {
    project_key: 'TEST',
    site_url: 'https://test.atlassian.net',
    story_type: 'Story',
    subtask_type: 'Subtask',
    story_points_field: 'story_points',
    status_mapping: {},
  };

  function createTestTokenStore(tokens?: Record<string, string>): TokenStore {
    const envPath = join(envDir, `.env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Pre-write tokens to env file to avoid async setToken lock contention
    const content = tokens
      ? Object.entries(tokens)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      : '';
    writeFileSync(envPath, content);
    const store = new TokenStore(envPath);
    // Sync-load the tokens we just wrote
    if (tokens) {
      for (const [key, value] of Object.entries(tokens)) {
        // Set in memory only (tokens are already on disk)
        (store as any).tokens[key] = value;
      }
    }
    return store;
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-sync-test-'));
    // Create a manager agent for logging purposes
    db.run(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
  });

  it('skips sync when no status mapping configured', async () => {
    const tokenStore = createTestTokenStore();
    const config: JiraConfig = { ...baseConfig, status_mapping: {} };

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });

  it('skips stories without Jira issue key', async () => {
    // Create story without Jira key
    createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    const tokenStore = createTestTokenStore();
    const config: JiraConfig = { ...baseConfig, status_mapping: { 'To Do': 'planned' } };

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });

  it('syncs Jira status to Hive when different', async () => {
    // Create story with Jira key
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    // Update story to add Jira key and set initial status
    run(db, 'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'TEST-123',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const config: JiraConfig = {
      ...baseConfig,
      status_mapping: {
        'To Do': 'planned',
        'In Progress': 'in_progress',
      },
    };

    // Mock getIssue to return Jira issue with different status
    const mockJiraIssue: JiraIssue = {
      id: '10001',
      key: 'TEST-123',
      self: 'https://test.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'Test Issue',
        status: {
          id: '3',
          name: 'In Progress',
          statusCategory: { id: 3, key: 'indeterminate', name: 'In Progress' },
        },
        issuetype: {
          id: '10001',
          name: 'Story',
          subtask: false,
        },
        labels: [],
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-02T00:00:00.000Z',
        project: {
          id: '10000',
          key: 'TEST',
          name: 'Test Project',
        },
      },
    };

    const { getIssue } = await import('./issues.js');
    vi.mocked(getIssue).mockResolvedValue(mockJiraIssue);

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(1);

    // Verify story was updated
    const updatedStory = getStoryById(db, story.id);
    expect(updatedStory?.status).toBe('in_progress');
  });

  it('skips sync when Jira status matches Hive status', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    run(db, 'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'TEST-123',
      'in_progress',
      story.id,
    ]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const config: JiraConfig = {
      ...baseConfig,
      status_mapping: { 'In Progress': 'in_progress' },
    };

    const mockJiraIssue: JiraIssue = {
      id: '10001',
      key: 'TEST-123',
      self: 'https://test.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'Test Issue',
        status: {
          id: '3',
          name: 'In Progress',
          statusCategory: { id: 3, key: 'indeterminate', name: 'In Progress' },
        },
        issuetype: {
          id: '10001',
          name: 'Story',
          subtask: false,
        },
        labels: [],
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-02T00:00:00.000Z',
        project: {
          id: '10000',
          key: 'TEST',
          name: 'Test Project',
        },
      },
    };

    const { getIssue } = await import('./issues.js');
    vi.mocked(getIssue).mockResolvedValue(mockJiraIssue);

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });

  it('handles API errors gracefully', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    run(db, 'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'TEST-123',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const config: JiraConfig = {
      ...baseConfig,
      status_mapping: { 'To Do': 'planned' },
    };

    const { getIssue } = await import('./issues.js');
    vi.mocked(getIssue).mockRejectedValue(new Error('API Error'));

    // Should not throw - errors are logged
    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });

  it('skips backward transitions (prevents status regression)', async () => {
    // Story is in_progress in Hive, but Jira says "To Do" (which maps to planned)
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    run(db, 'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'TEST-123',
      'in_progress',
      story.id,
    ]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const config: JiraConfig = {
      ...baseConfig,
      status_mapping: {
        'To Do': 'planned',
        'In Progress': 'in_progress',
      },
    };

    // Jira reports "To Do" which maps to "planned" — backward from "in_progress"
    const mockJiraIssue: JiraIssue = {
      id: '10001',
      key: 'TEST-123',
      self: 'https://test.atlassian.net/rest/api/3/issue/10001',
      fields: {
        summary: 'Test Issue',
        status: {
          id: '1',
          name: 'To Do',
          statusCategory: { id: 2, key: 'new', name: 'To Do' },
        },
        issuetype: {
          id: '10001',
          name: 'Story',
          subtask: false,
        },
        labels: [],
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-02T00:00:00.000Z',
        project: {
          id: '10000',
          key: 'TEST',
          name: 'Test Project',
        },
      },
    };

    const { getIssue } = await import('./issues.js');
    vi.mocked(getIssue).mockResolvedValue(mockJiraIssue);

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    // Should NOT update — backward transition blocked
    expect(updated).toBe(0);

    // Verify story was NOT regressed
    const updatedStory = getStoryById(db, story.id);
    expect(updatedStory?.status).toBe('in_progress');
  });

  it('skips merged stories', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    run(db, 'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'TEST-123',
      'merged',
      story.id,
    ]);

    const tokenStore = createTestTokenStore();
    const config: JiraConfig = { ...baseConfig, status_mapping: { 'To Do': 'planned' } };

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });
});

describe('syncUnsyncedStoriesToJira', () => {
  let db: Database;
  let envDir: string;

  const baseConfig: JiraConfig = {
    project_key: 'TEST',
    site_url: 'https://test.atlassian.net',
    story_type: 'Story',
    subtask_type: 'Subtask',
    story_points_field: 'story_points',
    status_mapping: {},
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

  beforeEach(async () => {
    db = await createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-sync-unsynced-test-'));
    db.run(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
  });

  it('returns 0 when all stories already have jira keys', async () => {
    const story = createStory(db, {
      title: 'Synced Story',
      description: 'Already synced',
    });
    run(db, 'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-1',
      'TEST-1',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore();
    const synced = await syncUnsyncedStoriesToJira(db, tokenStore, baseConfig);
    expect(synced).toBe(0);
  });

  it('returns 0 when no stories exist', async () => {
    const tokenStore = createTestTokenStore();
    const synced = await syncUnsyncedStoriesToJira(db, tokenStore, baseConfig);
    expect(synced).toBe(0);
  });

  it('skips draft stories without jira keys', async () => {
    createStory(db, {
      title: 'Draft Story',
      description: 'Still in draft',
    });
    // Default status is 'draft', so it should be skipped

    const tokenStore = createTestTokenStore();
    const synced = await syncUnsyncedStoriesToJira(db, tokenStore, baseConfig);
    expect(synced).toBe(0);
  });

  it('syncs stories without jira keys that have a requirement', async () => {
    // Create a requirement
    run(db, `INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
      'REQ-TEST',
      'Test Req',
      'Test requirement',
      'planned',
    ]);

    // Create a team
    run(db, `INSERT INTO teams (id, repo_url, repo_path, name) VALUES (?, ?, ?, ?)`, [
      'team-test',
      'https://github.com/test/test.git',
      'repos/test',
      'test-team',
    ]);

    // Create story without jira key but with requirement and non-draft status
    const story = createStory(db, {
      requirementId: 'REQ-TEST',
      teamId: 'team-test',
      title: 'Unsynced Story',
      description: 'Needs Jira sync',
    });
    run(db, 'UPDATE stories SET status = ? WHERE id = ?', ['planned', story.id]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    // Mock syncRequirementToJira
    const { syncRequirementToJira } = await import('./stories.js');
    vi.mocked(syncRequirementToJira).mockResolvedValue({
      epicKey: 'TEST-100',
      epicId: '10100',
      stories: [{ storyId: story.id, jiraKey: 'TEST-101', jiraId: '10101' }],
      errors: [],
    });

    const synced = await syncUnsyncedStoriesToJira(db, tokenStore, baseConfig);
    expect(synced).toBe(1);
    expect(syncRequirementToJira).toHaveBeenCalledWith(
      db,
      tokenStore,
      baseConfig,
      expect.objectContaining({ id: 'REQ-TEST' }),
      [story.id],
      'team-test'
    );
  });

  it('skips stories without a requirement_id', async () => {
    const story = createStory(db, {
      title: 'Orphan Story',
      description: 'No requirement',
    });
    run(db, 'UPDATE stories SET status = ? WHERE id = ?', ['planned', story.id]);

    const tokenStore = createTestTokenStore();
    const synced = await syncUnsyncedStoriesToJira(db, tokenStore, baseConfig);
    expect(synced).toBe(0);
  });
});
