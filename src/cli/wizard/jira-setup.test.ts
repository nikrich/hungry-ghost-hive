// Licensed under the Hungry Ghost Hive License. See LICENSE.

import http from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  autoDetectStatusMapping,
  createJiraBoard,
  parseBoardIdFromUrl,
  validateBoardId,
  type JiraStatus,
} from './jira-setup.js';

describe('autoDetectStatusMapping', () => {
  it('should map statuses based on category key', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'To Do',
        statusCategory: { id: 1, key: 'new', name: 'To Do' },
      },
      {
        id: '2',
        name: 'In Progress',
        statusCategory: { id: 2, key: 'indeterminate', name: 'In Progress' },
      },
      {
        id: '3',
        name: 'Done',
        statusCategory: { id: 3, key: 'done', name: 'Done' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['To Do']).toBe('draft');
    expect(mapping['In Progress']).toBe('in_progress');
    expect(mapping['Done']).toBe('merged');
  });

  it('should use naming patterns as fallback', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'Backlog',
        statusCategory: { id: 1, key: 'other', name: 'Other' },
      },
      {
        id: '2',
        name: 'In Development',
        statusCategory: { id: 2, key: 'other', name: 'Other' },
      },
      {
        id: '3',
        name: 'In Review',
        statusCategory: { id: 3, key: 'other', name: 'Other' },
      },
      {
        id: '4',
        name: 'Closed',
        statusCategory: { id: 4, key: 'other', name: 'Other' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['Backlog']).toBe('draft');
    expect(mapping['In Development']).toBe('in_progress');
    expect(mapping['In Review']).toBe('review');
    expect(mapping['Closed']).toBe('merged');
  });

  it('should default to in_progress for unknown statuses', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'Unknown Status',
        statusCategory: { id: 1, key: 'other', name: 'Other' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['Unknown Status']).toBe('in_progress');
  });

  it('should handle mixed case status names', () => {
    const statuses: JiraStatus[] = [
      {
        id: '1',
        name: 'TODO',
        statusCategory: { id: 1, key: 'other', name: 'Other' },
      },
      {
        id: '2',
        name: 'DOING',
        statusCategory: { id: 2, key: 'other', name: 'Other' },
      },
      {
        id: '3',
        name: 'TESTING',
        statusCategory: { id: 3, key: 'other', name: 'Other' },
      },
      {
        id: '4',
        name: 'COMPLETE',
        statusCategory: { id: 4, key: 'other', name: 'Other' },
      },
    ];

    const mapping = autoDetectStatusMapping(statuses);

    expect(mapping['TODO']).toBe('draft');
    expect(mapping['DOING']).toBe('in_progress');
    expect(mapping['TESTING']).toBe('qa');
    expect(mapping['COMPLETE']).toBe('merged');
  });
});

describe('parseBoardIdFromUrl', () => {
  it('should extract board ID from standard board URL', () => {
    expect(
      parseBoardIdFromUrl('https://mycompany.atlassian.net/jira/software/projects/PROJ/boards/42')
    ).toBe('42');
  });

  it('should extract board ID from company-managed board URL with /c/ segment', () => {
    expect(
      parseBoardIdFromUrl(
        'https://mycompany.atlassian.net/jira/software/c/projects/PROJ/boards/123'
      )
    ).toBe('123');
  });

  it('should extract board ID from RapidBoard URL', () => {
    expect(
      parseBoardIdFromUrl('https://mycompany.atlassian.net/secure/RapidBoard.jspa?rapidView=99')
    ).toBe('99');
  });

  it('should extract board ID from RapidBoard URL with extra params', () => {
    expect(
      parseBoardIdFromUrl(
        'https://mycompany.atlassian.net/secure/RapidBoard.jspa?rapidView=7&projectKey=PROJ'
      )
    ).toBe('7');
  });

  it('should return null for invalid URL', () => {
    expect(parseBoardIdFromUrl('not-a-url')).toBeNull();
  });

  it('should return null for URL without board info', () => {
    expect(
      parseBoardIdFromUrl('https://mycompany.atlassian.net/jira/software/projects/PROJ')
    ).toBeNull();
  });

  it('should return null for RapidBoard URL with non-numeric rapidView', () => {
    expect(
      parseBoardIdFromUrl('https://mycompany.atlassian.net/secure/RapidBoard.jspa?rapidView=abc')
    ).toBeNull();
  });
});

describe('validateBoardId', () => {
  let mockServer: http.Server;
  let port: number;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    await new Promise<void>(resolve => {
      mockServer = http.createServer((req, res) => {
        if (req.url?.includes('/board/42')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 42, name: 'Test Board', type: 'scrum', self: '' }));
        } else if (req.url?.includes('/board/999')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errorMessages: ['Board not found'] }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      mockServer.listen(0, () => {
        port = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const rewritten = urlStr.replace(
        /https:\/\/api\.atlassian\.com\/ex\/jira\/[^/]+\/rest\/agile\/1\.0/,
        `http://127.0.0.1:${port}/rest/agile/1.0`
      );
      return originalFetch(rewritten, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    mockServer?.close();
  });

  it('should return board data for valid board ID', async () => {
    const board = await validateBoardId('cloud-123', 'token', '42');
    expect(board).not.toBeNull();
    expect(board!.id).toBe(42);
    expect(board!.name).toBe('Test Board');
  });

  it('should return null for invalid board ID', async () => {
    const board = await validateBoardId('cloud-123', 'token', '999');
    expect(board).toBeNull();
  });
});

describe('createJiraBoard', () => {
  let mockServer: http.Server;
  let port: number;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    await new Promise<void>(resolve => {
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          if (req.method === 'POST' && req.url?.includes('/rest/api/3/filter')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: '100' }));
          } else if (req.method === 'POST' && req.url?.includes('/rest/agile/1.0/board')) {
            const parsed = JSON.parse(body);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 55,
                name: parsed.name,
                type: parsed.type,
                self: '',
              })
            );
          } else {
            res.writeHead(404);
            res.end();
          }
        });
      });
      mockServer.listen(0, () => {
        port = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      const rewritten = urlStr
        .replace(
          /https:\/\/api\.atlassian\.com\/ex\/jira\/[^/]+\/rest\/agile\/1\.0/,
          `http://127.0.0.1:${port}/rest/agile/1.0`
        )
        .replace(
          /https:\/\/api\.atlassian\.com\/ex\/jira\/[^/]+\/rest\/api\/3/,
          `http://127.0.0.1:${port}/rest/api/3`
        );
      return originalFetch(rewritten, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    mockServer?.close();
  });

  it('should create a scrum board', async () => {
    const board = await createJiraBoard('cloud-123', 'token', {
      name: 'My Scrum Board',
      type: 'scrum',
      projectKey: 'PROJ',
    });
    expect(board.id).toBe(55);
    expect(board.name).toBe('My Scrum Board');
    expect(board.type).toBe('scrum');
  });

  it('should create a kanban board', async () => {
    const board = await createJiraBoard('cloud-123', 'token', {
      name: 'My Kanban Board',
      type: 'kanban',
      projectKey: 'PROJ',
    });
    expect(board.id).toBe(55);
    expect(board.name).toBe('My Kanban Board');
    expect(board.type).toBe('kanban');
  });
});

describe('JiraConfig schema validation', () => {
  it('should accept config with new watch_board and board_poll_interval_ms fields', async () => {
    const { HiveConfigSchema } = await import('../../config/schema.js');
    const config = HiveConfigSchema.parse({
      integrations: {
        project_management: {
          provider: 'jira',
          jira: {
            project_key: 'TEST',
            site_url: 'https://test.atlassian.net',
            board_id: '1',
            watch_board: false,
            board_poll_interval_ms: 30000,
          },
        },
      },
    });

    expect(config.integrations.project_management.jira!.watch_board).toBe(false);
    expect(config.integrations.project_management.jira!.board_poll_interval_ms).toBe(30000);
  });

  it('should default watch_board to true and board_poll_interval_ms to 60000', async () => {
    const { HiveConfigSchema } = await import('../../config/schema.js');
    const config = HiveConfigSchema.parse({
      integrations: {
        project_management: {
          provider: 'jira',
          jira: {
            project_key: 'TEST',
            site_url: 'https://test.atlassian.net',
            board_id: '1',
          },
        },
      },
    });

    expect(config.integrations.project_management.jira!.watch_board).toBe(true);
    expect(config.integrations.project_management.jira!.board_poll_interval_ms).toBe(60000);
  });

  it('should reject negative board_poll_interval_ms', async () => {
    const { HiveConfigSchema } = await import('../../config/schema.js');
    expect(() =>
      HiveConfigSchema.parse({
        integrations: {
          project_management: {
            provider: 'jira',
            jira: {
              project_key: 'TEST',
              site_url: 'https://test.atlassian.net',
              board_id: '1',
              board_poll_interval_ms: -1,
            },
          },
        },
      })
    ).toThrow();
  });
});
