// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import { JiraClient } from './client.js';
import {
  findTransitionForStatus,
  reverseStatusMapping,
  transitionJiraIssue,
} from './transitions.js';
import type { JiraTransition, JiraTransitionsResponse } from './types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jira-transitions-test-'));
  tempDirs.push(dir);
  return dir;
}

async function createClient(): Promise<JiraClient> {
  const dir = createTempDir();
  const envPath = join(dir, '.env');
  writeFileSync(
    envPath,
    'JIRA_ACCESS_TOKEN=test-token\nJIRA_CLOUD_ID=cloud-test\nJIRA_REFRESH_TOKEN=refresh-tok\n',
    'utf-8'
  );
  const store = new TokenStore(envPath);
  await store.loadFromEnv(envPath);
  return new JiraClient({
    tokenStore: store,
    clientId: 'cid',
    clientSecret: 'csecret',
  });
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

function startMockServer(handler: RouteHandler): Promise<{ server: Server; port: number }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

let originalFetch: typeof globalThis.fetch;
let mockServer: Server | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockServer?.close();
  mockServer = undefined;
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  vi.restoreAllMocks();
});

function routeFetch(port: number): void {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('api.atlassian.com')) {
      const parsed = new URL(url);
      return originalFetch(`http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`, init);
    }
    return originalFetch(input, init);
  };
}

describe('reverseStatusMapping', () => {
  it('should invert a Jira→Hive mapping to Hive→Jira[]', () => {
    const mapping = {
      'To Do': 'draft',
      Backlog: 'draft',
      'In Progress': 'in_progress',
      'In Review': 'review',
      Done: 'merged',
    };

    const reversed = reverseStatusMapping(mapping);

    expect(reversed).toEqual({
      draft: ['To Do', 'Backlog'],
      in_progress: ['In Progress'],
      review: ['In Review'],
      merged: ['Done'],
    });
  });

  it('should handle empty mapping', () => {
    const reversed = reverseStatusMapping({});
    expect(reversed).toEqual({});
  });

  it('should handle single entry per Hive status', () => {
    const mapping = {
      'In Progress': 'in_progress',
      Done: 'merged',
    };

    const reversed = reverseStatusMapping(mapping);

    expect(reversed).toEqual({
      in_progress: ['In Progress'],
      merged: ['Done'],
    });
  });
});

describe('findTransitionForStatus', () => {
  const transitions: JiraTransition[] = [
    {
      id: '11',
      name: 'To Do',
      to: { id: '1', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
    },
    {
      id: '21',
      name: 'Start Progress',
      to: {
        id: '3',
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
      },
    },
    {
      id: '31',
      name: 'Done',
      to: { id: '5', name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } },
    },
  ];

  it('should find a transition matching one of the target status names', () => {
    const result = findTransitionForStatus(transitions, ['In Progress']);
    expect(result).toBeDefined();
    expect(result!.id).toBe('21');
    expect(result!.to.name).toBe('In Progress');
  });

  it('should match case-insensitively', () => {
    const result = findTransitionForStatus(transitions, ['in progress']);
    expect(result).toBeDefined();
    expect(result!.id).toBe('21');
  });

  it('should return the first match when multiple candidates exist', () => {
    const result = findTransitionForStatus(transitions, ['Done', 'To Do']);
    expect(result).toBeDefined();
    // "To Do" appears first in the transitions list
    expect(result!.to.name).toBe('To Do');
  });

  it('should return undefined when no matching transition exists', () => {
    const result = findTransitionForStatus(transitions, ['Cancelled']);
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty target list', () => {
    const result = findTransitionForStatus(transitions, []);
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty transitions list', () => {
    const result = findTransitionForStatus([], ['In Progress']);
    expect(result).toBeUndefined();
  });
});

describe('transitionJiraIssue', () => {
  const statusMapping = {
    'To Do': 'draft',
    'In Progress': 'in_progress',
    'In Review': 'review',
    Done: 'merged',
  };

  it('should transition an issue to the mapped Jira status', async () => {
    const client = await createClient();
    let transitionCalled = false;
    let capturedBody = '';

    const transitionsResponse: JiraTransitionsResponse = {
      transitions: [
        {
          id: '11',
          name: 'To Do',
          to: { id: '1', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
        },
        {
          id: '31',
          name: 'Mark Done',
          to: { id: '5', name: 'Done', statusCategory: { id: 3, key: 'done', name: 'Done' } },
        },
      ],
    };

    const { server, port } = await startMockServer((req, res, body) => {
      if (req.method === 'GET' && req.url?.includes('/transitions')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(transitionsResponse));
      } else if (req.method === 'POST' && req.url?.includes('/transitions')) {
        transitionCalled = true;
        capturedBody = body;
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    mockServer = server;
    routeFetch(port);

    const result = await transitionJiraIssue(client, 'PROJ-1', 'merged', statusMapping);

    expect(result).toBe(true);
    expect(transitionCalled).toBe(true);
    expect(JSON.parse(capturedBody)).toEqual({ transition: { id: '31' } });
  });

  it('should return false when no mapping exists for the Hive status', async () => {
    const client = await createClient();

    const result = await transitionJiraIssue(client, 'PROJ-1', 'qa_failed', statusMapping);

    expect(result).toBe(false);
  });

  it('should return false when no matching transition is available', async () => {
    const client = await createClient();

    const transitionsResponse: JiraTransitionsResponse = {
      transitions: [
        {
          id: '11',
          name: 'To Do',
          to: { id: '1', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
        },
      ],
    };

    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(transitionsResponse));
    });
    mockServer = server;
    routeFetch(port);

    // "merged" maps to "Done" but only "To Do" transition is available
    const result = await transitionJiraIssue(client, 'PROJ-1', 'merged', statusMapping);

    expect(result).toBe(false);
  });

  it('should handle multiple Jira statuses mapping to the same Hive status', async () => {
    const client = await createClient();
    let capturedBody = '';

    const multiMapping = {
      'To Do': 'draft',
      Backlog: 'draft',
      'In Progress': 'in_progress',
      Done: 'merged',
    };

    const transitionsResponse: JiraTransitionsResponse = {
      transitions: [
        {
          id: '41',
          name: 'Move to Backlog',
          to: {
            id: '7',
            name: 'Backlog',
            statusCategory: { id: 2, key: 'new', name: 'To Do' },
          },
        },
      ],
    };

    const { server, port } = await startMockServer((req, res, body) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(transitionsResponse));
      } else if (req.method === 'POST') {
        capturedBody = body;
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    mockServer = server;
    routeFetch(port);

    // "draft" maps to both "To Do" and "Backlog"; "Backlog" is available
    const result = await transitionJiraIssue(client, 'PROJ-1', 'draft', multiMapping);

    expect(result).toBe(true);
    expect(JSON.parse(capturedBody)).toEqual({ transition: { id: '41' } });
  });

  it('should throw on API errors (caller handles gracefully)', async () => {
    const client = await createClient();

    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Internal server error' }));
    });
    mockServer = server;
    routeFetch(port);

    await expect(
      transitionJiraIssue(client, 'PROJ-1', 'merged', statusMapping)
    ).rejects.toThrow();
  });

  it('should return false for empty status mapping', async () => {
    const client = await createClient();

    const result = await transitionJiraIssue(client, 'PROJ-1', 'merged', {});

    expect(result).toBe(false);
  });
});
