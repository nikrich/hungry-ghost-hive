// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraConfig } from '../../config/schema.js';
import { queryAll, queryOne } from '../../db/client.js';
import type { RequirementRow } from '../../db/queries/requirements.js';
import { adfToPlainText, pollBoardForEpics } from './board-watcher.js';
import type { AdfDocument, JiraSearchResponse } from './types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'board-watcher-test-'));
  tempDirs.push(dir);
  return dir;
}

function createHiveDir(): string {
  const dir = createTempDir();
  writeFileSync(
    join(dir, '.env'),
    'JIRA_ACCESS_TOKEN=test-token\nJIRA_CLOUD_ID=cloud-test\nJIRA_REFRESH_TOKEN=refresh-tok\n',
    'utf-8'
  );
  return dir;
}

async function createTestDb(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'human',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed')),
      godmode BOOLEAN DEFAULT 0,
      target_branch TEXT DEFAULT 'main',
      jira_epic_key TEXT,
      jira_epic_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS integration_sync (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('story', 'requirement', 'pull_request')),
      entity_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('jira', 'github', 'confluence')),
      external_id TEXT NOT NULL,
      last_synced_at TIMESTAMP,
      sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      story_id TEXT,
      event_type TEXT NOT NULL,
      status TEXT,
      message TEXT,
      metadata TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

const defaultConfig: JiraConfig = {
  project_key: 'PROJ',
  site_url: 'https://test.atlassian.net',
  board_id: '1',
  story_type: 'Story',
  subtask_type: 'Subtask',
  status_mapping: {},
  watch_board: true,
  board_poll_interval_ms: 60000,
};

function makeEpicIssue(key: string, id: string, summary: string, description?: AdfDocument) {
  return {
    id,
    key,
    self: `https://test.atlassian.net/rest/api/3/issue/${id}`,
    fields: {
      summary,
      description: description ?? null,
      status: {
        id: '1',
        name: 'To Do',
        statusCategory: { id: 2, key: 'new', name: 'To Do' },
      },
      issuetype: { id: '10000', name: 'Epic', subtask: false },
      labels: [],
      created: '2024-01-01T00:00:00.000Z',
      updated: '2024-01-01T00:00:00.000Z',
      project: { id: '1', key: 'PROJ', name: 'Project' },
    },
  };
}

function makeSearchResponse(issues: any[], total?: number): JiraSearchResponse {
  return {
    startAt: 0,
    maxResults: 50,
    total: total ?? issues.length,
    issues,
  };
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
      // Ignore
    }
  }
  vi.restoreAllMocks();
});

// ── adfToPlainText ────────────────────────────────────────────────────────────

describe('adfToPlainText', () => {
  it('should return empty string for null/undefined', () => {
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText(undefined)).toBe('');
  });

  it('should extract text from a simple paragraph', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('Hello world');
  });

  it('should handle multiple paragraphs', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph' }],
        },
      ],
    };
    const text = adfToPlainText(doc);
    expect(text).toContain('First paragraph');
    expect(text).toContain('Second paragraph');
  });

  it('should handle nested structures (headings, lists)', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 1' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item 2' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const text = adfToPlainText(doc);
    expect(text).toContain('Title');
    expect(text).toContain('Item 1');
    expect(text).toContain('Item 2');
  });

  it('should handle empty document content', () => {
    const doc: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [],
    };
    expect(adfToPlainText(doc)).toBe('');
  });
});

// ── pollBoardForEpics ─────────────────────────────────────────────────────────

describe('pollBoardForEpics', () => {
  it('should ingest new epics as requirements', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    const epics = [
      makeEpicIssue('PROJ-1', '10001', 'Build user auth'),
      makeEpicIssue('PROJ-2', '10002', 'Add payment flow'),
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(makeSearchResponse(epics)),
    } as Response);

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    expect(result.ingestedCount).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.requirements).toHaveLength(2);
    expect(result.requirements[0].epicKey).toBe('PROJ-1');
    expect(result.requirements[1].epicKey).toBe('PROJ-2');

    // Verify requirements were created in the DB
    const reqs = queryAll<RequirementRow>(db, 'SELECT * FROM requirements ORDER BY created_at');
    expect(reqs).toHaveLength(2);
    expect(reqs[0].jira_epic_key).toBe('PROJ-1');
    expect(reqs[0].jira_epic_id).toBe('10001');
    expect(reqs[0].submitted_by).toBe('jira-board-watcher');
    expect(reqs[1].jira_epic_key).toBe('PROJ-2');

    // Verify integration_sync records
    const syncs = queryAll(db, 'SELECT * FROM integration_sync');
    expect(syncs).toHaveLength(2);

    // Verify agent_logs
    const logs = queryAll(db, 'SELECT * FROM agent_logs');
    // Should have: poll started, 2x epic ingested, poll completed = 4 entries
    expect(logs.length).toBe(4);

    db.close();
  });

  it('should skip already-synced epics', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    // Pre-create a requirement with jira_epic_key set (already synced)
    db.run(
      "INSERT INTO requirements (id, title, description, jira_epic_key, jira_epic_id) VALUES ('REQ-EXIST', 'Existing', 'Already synced', 'PROJ-1', '10001')"
    );

    // Only PROJ-2 should be found (PROJ-1 excluded via JQL)
    const epics = [makeEpicIssue('PROJ-2', '10002', 'New epic')];

    let capturedBody = '';
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(makeSearchResponse(epics)),
      } as Response;
    });

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    expect(result.ingestedCount).toBe(1);
    expect(result.requirements[0].epicKey).toBe('PROJ-2');

    // Verify JQL excludes PROJ-1
    const parsed = JSON.parse(capturedBody);
    expect(parsed.jql).toContain('key NOT IN');
    expect(parsed.jql).toContain('PROJ-1');

    db.close();
  });

  it('should handle no new epics found', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(makeSearchResponse([])),
    } as Response);

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    expect(result.ingestedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.requirements).toHaveLength(0);

    db.close();
  });

  it('should handle Jira API errors gracefully', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    expect(result.ingestedCount).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Failed to search Jira for epics');

    db.close();
  });

  it('should handle pagination when there are more epics than maxResults', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    // First page: 50 results, total: 51
    const firstPageEpics = Array.from({ length: 50 }, (_, i) =>
      makeEpicIssue(`PROJ-${i + 1}`, `${10000 + i + 1}`, `Epic ${i + 1}`)
    );

    // Second page: 1 result
    const secondPageEpics = [makeEpicIssue('PROJ-51', '10051', 'Epic 51')];

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      const issues = callCount === 1 ? firstPageEpics : secondPageEpics;
      const total = 51;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            startAt: callCount === 1 ? 0 : 50,
            maxResults: 50,
            total,
            issues,
          }),
      } as Response;
    });

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    expect(result.ingestedCount).toBe(51);
    expect(callCount).toBe(2);

    db.close();
  });

  it('should extract description from ADF format', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    const adfDescription: AdfDocument = {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Implement OAuth 2.0 authentication for API access.' }],
        },
      ],
    };

    const epics = [makeEpicIssue('PROJ-1', '10001', 'OAuth Implementation', adfDescription)];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(makeSearchResponse(epics)),
    } as Response);

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    expect(result.ingestedCount).toBe(1);

    const req = queryOne<RequirementRow>(db, 'SELECT * FROM requirements');
    expect(req?.description).toContain('Implement OAuth 2.0 authentication');

    db.close();
  });

  it('should use epic summary as description fallback when ADF is empty', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    const epics = [makeEpicIssue('PROJ-1', '10001', 'My Epic Title')];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(makeSearchResponse(epics)),
    } as Response);

    const result = await pollBoardForEpics(db, hiveDir, defaultConfig);

    const req = queryOne<RequirementRow>(db, 'SELECT * FROM requirements');
    expect(req?.title).toBe('My Epic Title');
    expect(req?.description).toBe('My Epic Title');
    expect(result.ingestedCount).toBe(1);

    db.close();
  });

  it('should log poll start and completion events', async () => {
    const db = await createTestDb();
    const hiveDir = createHiveDir();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(makeSearchResponse([])),
    } as Response);

    await pollBoardForEpics(db, hiveDir, defaultConfig);

    const logs = queryAll<{ event_type: string; message: string }>(
      db,
      'SELECT event_type, message FROM agent_logs ORDER BY id'
    );

    expect(logs).toHaveLength(2);
    expect(logs[0].event_type).toBe('JIRA_BOARD_POLL_STARTED');
    expect(logs[1].event_type).toBe('JIRA_BOARD_POLL_COMPLETED');

    db.close();
  });
});
