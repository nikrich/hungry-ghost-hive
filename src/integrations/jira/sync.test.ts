// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import { run } from '../../db/client.js';
import { createStory, getStoryById } from '../../db/queries/stories.js';
import { createTestDatabase } from '../../db/queries/test-helpers.js';
import { jiraStatusToHiveStatus, syncJiraStatusesToHive } from './sync.js';
import type { JiraIssue } from './types.js';

// Mock Jira client and issues module
vi.mock('./client.js');
vi.mock('./issues.js');

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

describe('syncJiraStatusesToHive', () => {
  let db: Database;

  const baseConfig: JiraConfig = {
    project_key: 'TEST',
    site_url: 'https://test.atlassian.net',
    board_id: '1',
    story_type: 'Story',
    subtask_type: 'Subtask',
    status_mapping: {},
    watch_board: false,
    board_poll_interval_ms: 60000,
  };

  beforeEach(async () => {
    db = await createTestDatabase();
    // Create a manager agent for logging purposes
    db.run(`INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')`);
  });

  it('skips sync when no status mapping configured', async () => {
    const tokenStore = new TokenStore(':memory:');
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

    const tokenStore = new TokenStore(':memory:');
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
    run(db, 'UPDATE stories SET jira_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'planned',
      story.id,
    ]);

    const tokenStore = new TokenStore(':memory:');
    tokenStore.setToken('jira_access', 'fake-token');
    tokenStore.setToken('jira_cloud_id', 'fake-cloud-id');

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

    run(db, 'UPDATE stories SET jira_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'in_progress',
      story.id,
    ]);

    const tokenStore = new TokenStore(':memory:');
    tokenStore.setToken('jira_access', 'fake-token');
    tokenStore.setToken('jira_cloud_id', 'fake-cloud-id');

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

    run(db, 'UPDATE stories SET jira_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'planned',
      story.id,
    ]);

    const tokenStore = new TokenStore(':memory:');
    tokenStore.setToken('jira_access', 'fake-token');
    tokenStore.setToken('jira_cloud_id', 'fake-cloud-id');

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

  it('skips merged stories', async () => {
    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test',
    });

    run(db, 'UPDATE stories SET jira_issue_key = ?, status = ? WHERE id = ?', [
      'TEST-123',
      'merged',
      story.id,
    ]);

    const tokenStore = new TokenStore(':memory:');
    const config: JiraConfig = { ...baseConfig, status_mapping: { 'To Do': 'planned' } };

    const updated = await syncJiraStatusesToHive(db, tokenStore, config);
    expect(updated).toBe(0);
  });
});
