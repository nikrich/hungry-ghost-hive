// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import { run } from '../../db/client.js';
import { createSyncRecord } from '../../db/queries/integration-sync.js';
import { createStory, getStoryById } from '../../db/queries/stories.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import {
  isForwardTransition,
  jiraStatusToHiveStatus,
  retrySprintAssignment,
  syncHiveStatusesToJira,
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
  let db: Database.Database;
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
    db = createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-sync-test-'));
    // Create a manager agent for logging purposes
    db.exec(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
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
    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'planned', story.id]
    );

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

    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'in_progress', story.id]
    );

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

    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'planned', story.id]
    );

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

    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'in_progress', story.id]
    );

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

    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'merged', story.id]
    );

    const tokenStore = createTestTokenStore();
    const config: JiraConfig = { ...baseConfig, status_mapping: { 'To Do': 'planned' } };

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });
});

describe('syncUnsyncedStoriesToJira', () => {
  let db: Database.Database;
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
    db = createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-sync-unsynced-test-'));
    db.exec(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
  });

  it('returns 0 when all stories already have jira keys', async () => {
    const story = createStory(db, {
      title: 'Synced Story',
      description: 'Already synced',
    });
    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-1', 'TEST-1', 'planned', story.id]
    );

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

  it('re-query guard filters stories that gained jira_issue_key after initial query', async () => {
    // Create a requirement
    run(db, `INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
      'REQ-GUARD',
      'Guard Req',
      'Test re-query guard',
      'planned',
    ]);

    // Create TWO stories without jira key
    const story1 = createStory(db, {
      requirementId: 'REQ-GUARD',
      title: 'Story 1 - will get key',
      description: 'Gets key before re-query',
    });
    const story2 = createStory(db, {
      requirementId: 'REQ-GUARD',
      title: 'Story 2 - stays unsynced',
      description: 'Stays without key',
    });
    run(db, 'UPDATE stories SET status = ? WHERE id = ?', ['planned', story1.id]);
    run(db, 'UPDATE stories SET status = ? WHERE id = ?', ['planned', story2.id]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    // Mock syncRequirementToJira to simulate: between initial query and call,
    // story1 gets a jira key (via the mock updating the DB when called).
    // But the re-query guard inside syncUnsyncedStoriesToJira re-checks each story.
    const { syncRequirementToJira } = await import('./stories.js');
    vi.mocked(syncRequirementToJira).mockReset();

    // Give story1 a jira key BEFORE calling sync — this means the re-query guard
    // will find it already has a key and filter it out, only passing story2 to sync.
    run(db, 'UPDATE stories SET jira_issue_key = ? WHERE id = ?', ['TEST-999', story1.id]);

    vi.mocked(syncRequirementToJira).mockResolvedValue({
      epicKey: 'TEST-100',
      epicId: '10100',
      stories: [{ storyId: story2.id, jiraKey: 'TEST-101', jiraId: '10101' }],
      errors: [],
    });

    const synced = await syncUnsyncedStoriesToJira(db, tokenStore, baseConfig);
    // Only story2 should be synced (story1 was filtered by initial query since it now has a key)
    expect(synced).toBe(1);
    // Verify only story2 was passed to syncRequirementToJira
    expect(syncRequirementToJira).toHaveBeenCalledWith(
      db,
      tokenStore,
      baseConfig,
      expect.objectContaining({ id: 'REQ-GUARD' }),
      [story2.id],
      undefined
    );
  });
});

describe('retrySprintAssignment', () => {
  let db: Database.Database;
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
    db = createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-sprint-retry-test-'));
    db.exec(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
  });

  it('returns 0 when no stories need sprint assignment', async () => {
    const tokenStore = createTestTokenStore();
    const count = await retrySprintAssignment(db, tokenStore, baseConfig);
    expect(count).toBe(0);
  });

  it('returns 0 when all stories with jira keys are already in sprint', async () => {
    const story = createStory(db, {
      title: 'Sprint Story',
      description: 'Already in sprint',
    });
    run(db, 'UPDATE stories SET jira_issue_key = ?, in_sprint = 1, status = ? WHERE id = ?', [
      'TEST-1',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore();
    const count = await retrySprintAssignment(db, tokenStore, baseConfig);
    expect(count).toBe(0);
  });

  it('retries sprint assignment for stories not in sprint', async () => {
    const story = createStory(db, {
      title: 'Not In Sprint',
      description: 'Needs sprint assignment',
    });
    run(db, 'UPDATE stories SET jira_issue_key = ?, in_sprint = 0, status = ? WHERE id = ?', [
      'TEST-2',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    // Mock tryMoveToActiveSprint to succeed
    const { tryMoveToActiveSprint } = await import('./stories.js');
    vi.mocked(tryMoveToActiveSprint).mockResolvedValue(true);

    const count = await retrySprintAssignment(db, tokenStore, baseConfig);
    expect(count).toBe(1);

    // Verify tryMoveToActiveSprint was called with the right keys
    expect(tryMoveToActiveSprint).toHaveBeenCalledWith(
      expect.anything(), // JiraClient
      baseConfig,
      ['TEST-2']
    );

    // Verify in_sprint was updated
    const updated = getStoryById(db, story.id);
    expect(updated?.in_sprint).toBe(1);
  });

  it('returns 0 when sprint move fails', async () => {
    const story = createStory(db, {
      title: 'Sprint Fail',
      description: 'Sprint move will fail',
    });
    run(db, 'UPDATE stories SET jira_issue_key = ?, in_sprint = 0, status = ? WHERE id = ?', [
      'TEST-3',
      'planned',
      story.id,
    ]);

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    // Mock tryMoveToActiveSprint to fail
    const { tryMoveToActiveSprint } = await import('./stories.js');
    vi.mocked(tryMoveToActiveSprint).mockResolvedValue(false);

    const count = await retrySprintAssignment(db, tokenStore, baseConfig);
    expect(count).toBe(0);

    // Verify in_sprint was NOT updated
    const updated = getStoryById(db, story.id);
    expect(updated?.in_sprint).toBe(0);
  });

  it('skips merged stories', async () => {
    const story = createStory(db, {
      title: 'Merged Story',
      description: 'Already merged',
    });
    run(db, 'UPDATE stories SET jira_issue_key = ?, in_sprint = 0, status = ? WHERE id = ?', [
      'TEST-4',
      'merged',
      story.id,
    ]);

    const tokenStore = createTestTokenStore();
    const count = await retrySprintAssignment(db, tokenStore, baseConfig);
    expect(count).toBe(0);
  });
});

describe('idempotency guards', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDatabase();
  });

  it('unique index prevents duplicate integration_sync records', () => {
    // Create first sync record
    createSyncRecord(db, {
      entityType: 'story',
      entityId: 'STORY-001',
      provider: 'jira',
      externalId: '10001',
    });

    // Attempt to create a duplicate should fail due to unique index
    expect(() =>
      createSyncRecord(db, {
        entityType: 'story',
        entityId: 'STORY-001',
        provider: 'jira',
        externalId: '10002',
      })
    ).toThrow();
  });

  it('allows sync records for different providers on same entity', () => {
    createSyncRecord(db, {
      entityType: 'story',
      entityId: 'STORY-001',
      provider: 'jira',
      externalId: '10001',
    });

    // Different provider should succeed
    expect(() =>
      createSyncRecord(db, {
        entityType: 'story',
        entityId: 'STORY-001',
        provider: 'github',
        externalId: 'gh-001',
      })
    ).not.toThrow();
  });
});

describe('syncHiveStatusesToJira', () => {
  let db: Database.Database;
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
    vi.clearAllMocks();
    db = createTestDatabase();
    envDir = mkdtempSync(join(tmpdir(), 'hive-sync-push-test-'));
    db.exec(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
  });

  it('skips push when no status mapping configured', async () => {
    const tokenStore = createTestTokenStore();
    const config: JiraConfig = { ...baseConfig, status_mapping: {} };

    const pushed = await syncHiveStatusesToJira(db, tokenStore, config);
    expect(pushed).toBe(0);
  });

  it('skips stories without Jira issue key', async () => {
    createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    const tokenStore = createTestTokenStore();
    const config: JiraConfig = { ...baseConfig, status_mapping: { 'To Do': 'planned' } };

    const pushed = await syncHiveStatusesToJira(db, tokenStore, config);
    expect(pushed).toBe(0);
  });

  it('pushes Hive status to Jira when Hive is ahead', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    // Story is in_progress in Hive, but Jira still shows planned
    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'in_progress', story.id]
    );

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

    // Mock getIssue to return Jira issue with older status
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

    const { getIssue, getTransitions, transitionIssue } = await import('./issues.js');
    vi.mocked(getIssue).mockResolvedValue(mockJiraIssue);
    vi.mocked(getTransitions).mockResolvedValue({
      transitions: [
        {
          id: '11',
          name: 'Start Progress',
          to: {
            id: '3',
            name: 'In Progress',
            statusCategory: { id: 3, key: 'indeterminate', name: 'In Progress' },
          },
        },
      ],
    });
    vi.mocked(transitionIssue).mockResolvedValue(undefined);

    const pushed = await syncHiveStatusesToJira(db, tokenStore, config);
    expect(pushed).toBe(1);
    expect(transitionIssue).toHaveBeenCalledWith(expect.anything(), 'TEST-123', {
      transition: { id: '11' },
    });
  });

  it('skips push when Hive status matches Jira status', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'in_progress', story.id]
    );

    const tokenStore = createTestTokenStore({
      JIRA_ACCESS_TOKEN: 'fake-token',
      JIRA_CLOUD_ID: 'fake-cloud-id',
    });

    const config: JiraConfig = {
      ...baseConfig,
      status_mapping: { 'In Progress': 'in_progress' },
    };

    // Jira status already matches Hive status
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

    const pushed = await syncHiveStatusesToJira(db, tokenStore, config);
    expect(pushed).toBe(0);
  });

  it('prevents backward transitions when pushing to Jira', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    // Hive status is planned, but Jira is already in_progress (ahead)
    run(
      db,
      'UPDATE stories SET jira_issue_key = ?, external_issue_key = ?, status = ? WHERE id = ?',
      ['TEST-123', 'TEST-123', 'planned', story.id]
    );

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

    // Jira is ahead of Hive
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

    const { getIssue, transitionIssue } = await import('./issues.js');
    vi.mocked(getIssue).mockResolvedValue(mockJiraIssue);

    const pushed = await syncHiveStatusesToJira(db, tokenStore, config);
    expect(pushed).toBe(0);
    // Should not attempt to transition backward
    expect(transitionIssue).not.toHaveBeenCalled();
  });
});
