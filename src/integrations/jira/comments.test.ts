// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import { JiraClient } from './client.js';
import { createSubtask, postComment, postJiraLifecycleComment } from './comments.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jira-comments-test-'));
  tempDirs.push(dir);
  return dir;
}

function createTokenStore(tokens: Record<string, string>): { store: TokenStore; envPath: string } {
  const dir = createTempDir();
  const envPath = join(dir, '.env');
  const content = Object.entries(tokens)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  writeFileSync(envPath, content + '\n', 'utf-8');
  const store = new TokenStore(envPath);
  return { store, envPath };
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  vi.restoreAllMocks();
});

describe('createSubtask', () => {
  it('should create a Jira subtask with correct fields', async () => {
    const { store, envPath } = createTokenStore({
      JIRA_ACCESS_TOKEN: 'test-access',
      JIRA_CLOUD_ID: 'cloud-123',
    });
    await store.loadFromEnv(envPath);

    const mockResponse = {
      id: 'subtask-123',
      key: 'PROJ-456',
      self: 'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/subtask-123',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await createSubtask(client, {
      parentIssueKey: 'PROJ-123',
      projectKey: 'PROJ',
      agentName: 'hive-senior-team',
      storyTitle: 'Test Story',
    });

    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/issue'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Implementation by hive-senior-team'),
      })
    );
  });

  it('should return null and log warning on failure', async () => {
    const { store, envPath } = createTokenStore({
      JIRA_ACCESS_TOKEN: 'test-access',
      JIRA_CLOUD_ID: 'cloud-123',
    });
    await store.loadFromEnv(envPath);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await createSubtask(client, {
      parentIssueKey: 'PROJ-123',
      projectKey: 'PROJ',
      agentName: 'hive-senior-team',
      storyTitle: 'Test Story',
    });

    expect(result).toBeNull();
  });
});

describe('postComment', () => {
  it('should post a comment with correct ADF format for pr_created event', async () => {
    const { store, envPath } = createTokenStore({
      JIRA_ACCESS_TOKEN: 'test-access',
      JIRA_CLOUD_ID: 'cloud-123',
    });
    await store.loadFromEnv(envPath);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({}),
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await postComment(client, 'PROJ-123', 'pr_created', {
      agentName: 'hive-senior-team',
      prUrl: 'https://github.com/org/repo/pull/123',
    });

    expect(result).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/issue/PROJ-123/comment'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('git_pull_request'),
      })
    );
  });

  it('should return false on failure', async () => {
    const { store, envPath } = createTokenStore({
      JIRA_ACCESS_TOKEN: 'test-access',
      JIRA_CLOUD_ID: 'cloud-123',
    });
    await store.loadFromEnv(envPath);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const client = new JiraClient({
      tokenStore: store,
      clientId: 'cid',
      clientSecret: 'csecret',
    });

    const result = await postComment(client, 'PROJ-123', 'merged');

    expect(result).toBe(false);
  });
});

describe('postJiraLifecycleComment', () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();

    db.run(`
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        jira_issue_key TEXT,
        jira_subtask_key TEXT
      )
    `);

    db.run(
      `INSERT INTO stories (id, title, description, jira_issue_key) VALUES (?, ?, ?, ?)`,
      ['STORY-1', 'Test Story', 'Description', 'PROJ-123']
    );
  });

  it('should skip posting comment if story has no Jira issue key', async () => {
    db.run(`INSERT INTO stories (id, title, description) VALUES (?, ?, ?)`, [
      'STORY-2',
      'No Jira Story',
      'Description',
    ]);

    const hiveConfig = {
      integrations: {
        project_management: {
          provider: 'jira' as const,
          jira: {
            project_key: 'PROJ',
            story_type: 'Story',
          },
        },
      },
    } as any;

    const hiveDir = createTempDir();

    // Should not throw
    await postJiraLifecycleComment(db, hiveDir, hiveConfig, 'STORY-2', 'merged');
  });

  it('should skip posting comment if Jira is not configured', async () => {
    const hiveConfig = {
      integrations: {
        project_management: {
          provider: 'none' as const,
        },
      },
    } as any;

    const hiveDir = createTempDir();

    // Should not throw
    await postJiraLifecycleComment(db, hiveDir, hiveConfig, 'STORY-1', 'merged');
  });
});
