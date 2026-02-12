// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import { JiraClient } from './client.js';
import {
  createIssue,
  createIssueLink,
  getIssue,
  getTransitions,
  searchJql,
  transitionIssue,
  updateIssue,
} from './issues.js';
import type {
  CreateIssueLinkRequest,
  CreateIssueRequest,
  JiraIssue,
  JiraSearchResponse,
  JiraTransitionsResponse,
  TransitionIssueRequest,
} from './types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jira-issues-test-'));
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

describe('createIssue', () => {
  it('should create a new issue via POST /issue', async () => {
    const client = await createClient();
    let capturedBody = '';

    const { server, port } = await startMockServer((req, res, body) => {
      if (req.method === 'POST' && req.url?.includes('/issue')) {
        capturedBody = body;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: '10001', key: 'PROJ-1', self: 'https://...' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    mockServer = server;
    routeFetch(port);

    const request: CreateIssueRequest = {
      fields: {
        project: { key: 'PROJ' },
        summary: 'Test issue',
        issuetype: { name: 'Story' },
        labels: ['hive-managed'],
      },
    };

    const result = await createIssue(client, request);
    expect(result.id).toBe('10001');
    expect(result.key).toBe('PROJ-1');
    expect(JSON.parse(capturedBody)).toEqual(request);
  });
});

describe('updateIssue', () => {
  it('should update an issue via PUT /issue/{key}', async () => {
    const client = await createClient();
    let capturedMethod = '';
    let capturedUrl = '';

    const { server, port } = await startMockServer((req, res) => {
      capturedMethod = req.method ?? '';
      capturedUrl = req.url ?? '';
      res.writeHead(204);
      res.end();
    });
    mockServer = server;
    routeFetch(port);

    await updateIssue(client, 'PROJ-1', {
      fields: { summary: 'Updated summary' },
    });

    expect(capturedMethod).toBe('PUT');
    expect(capturedUrl).toContain('/issue/PROJ-1');
  });
});

describe('getIssue', () => {
  it('should fetch an issue by key', async () => {
    const client = await createClient();
    const mockIssue: JiraIssue = {
      id: '10001',
      key: 'PROJ-1',
      self: 'https://...',
      fields: {
        summary: 'My issue',
        status: { id: '1', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
        issuetype: { id: '10001', name: 'Story', subtask: false },
        labels: ['hive-managed'],
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
        project: { id: '1', key: 'PROJ', name: 'Project' },
      },
    };

    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockIssue));
    });
    mockServer = server;
    routeFetch(port);

    const result = await getIssue(client, 'PROJ-1');
    expect(result.key).toBe('PROJ-1');
    expect(result.fields.summary).toBe('My issue');
    expect(result.fields.status.name).toBe('To Do');
  });

  it('should pass fields parameter as query string', async () => {
    const client = await createClient();
    let capturedUrl = '';

    const { server, port } = await startMockServer((req, res) => {
      capturedUrl = req.url ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: '1',
          key: 'PROJ-1',
          self: 'https://...',
          fields: {
            summary: 'Test',
            status: {
              id: '1',
              name: 'To Do',
              statusCategory: { id: 2, key: 'new', name: 'To Do' },
            },
            issuetype: { id: '1', name: 'Story', subtask: false },
            labels: [],
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
            project: { id: '1', key: 'PROJ', name: 'Project' },
          },
        })
      );
    });
    mockServer = server;
    routeFetch(port);

    await getIssue(client, 'PROJ-1', ['summary', 'status']);
    expect(capturedUrl).toContain('fields=summary%2Cstatus');
  });
});

describe('transitionIssue', () => {
  it('should transition an issue via POST /issue/{key}/transitions', async () => {
    const client = await createClient();
    let capturedBody = '';
    let capturedUrl = '';

    const { server, port } = await startMockServer((req, res, body) => {
      capturedUrl = req.url ?? '';
      capturedBody = body;
      res.writeHead(204);
      res.end();
    });
    mockServer = server;
    routeFetch(port);

    const request: TransitionIssueRequest = {
      transition: { id: '31' },
    };

    await transitionIssue(client, 'PROJ-1', request);
    expect(capturedUrl).toContain('/issue/PROJ-1/transitions');
    expect(JSON.parse(capturedBody)).toEqual(request);
  });
});

describe('getTransitions', () => {
  it('should fetch available transitions for an issue', async () => {
    const client = await createClient();
    const mockResponse: JiraTransitionsResponse = {
      transitions: [
        {
          id: '11',
          name: 'To Do',
          to: { id: '1', name: 'To Do', statusCategory: { id: 2, key: 'new', name: 'To Do' } },
        },
        {
          id: '21',
          name: 'In Progress',
          to: {
            id: '3',
            name: 'In Progress',
            statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
          },
        },
      ],
    };

    const { server, port } = await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockResponse));
    });
    mockServer = server;
    routeFetch(port);

    const result = await getTransitions(client, 'PROJ-1');
    expect(result.transitions).toHaveLength(2);
    expect(result.transitions[0].name).toBe('To Do');
    expect(result.transitions[1].name).toBe('In Progress');
  });
});

describe('searchJql', () => {
  it('should search issues using JQL', async () => {
    const client = await createClient();
    let capturedBody = '';

    const mockResponse: JiraSearchResponse = {
      startAt: 0,
      maxResults: 50,
      total: 1,
      issues: [
        {
          id: '10001',
          key: 'PROJ-1',
          self: 'https://...',
          fields: {
            summary: 'Found issue',
            status: {
              id: '1',
              name: 'To Do',
              statusCategory: { id: 2, key: 'new', name: 'To Do' },
            },
            issuetype: { id: '1', name: 'Story', subtask: false },
            labels: ['hive-managed'],
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
            project: { id: '1', key: 'PROJ', name: 'Project' },
          },
        },
      ],
    };

    const { server, port } = await startMockServer((_req, res, body) => {
      capturedBody = body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockResponse));
    });
    mockServer = server;
    routeFetch(port);

    const result = await searchJql(client, 'project = PROJ AND labels = hive-managed', {
      maxResults: 25,
      fields: ['summary', 'status'],
    });

    expect(result.total).toBe(1);
    expect(result.issues[0].key).toBe('PROJ-1');
    const parsed = JSON.parse(capturedBody);
    expect(parsed.jql).toBe('project = PROJ AND labels = hive-managed');
    expect(parsed.maxResults).toBe(25);
    expect(parsed.fields).toEqual(['summary', 'status']);
  });

  it('should use default options when none provided', async () => {
    const client = await createClient();
    let capturedBody = '';

    const { server, port } = await startMockServer((_req, res, body) => {
      capturedBody = body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ startAt: 0, maxResults: 50, total: 0, issues: [] }));
    });
    mockServer = server;
    routeFetch(port);

    await searchJql(client, 'project = PROJ');
    const parsed = JSON.parse(capturedBody);
    expect(parsed.startAt).toBe(0);
    expect(parsed.maxResults).toBe(50);
  });
});

describe('createIssueLink', () => {
  it('should create a link between two issues', async () => {
    const client = await createClient();
    let capturedBody = '';
    let capturedUrl = '';

    const { server, port } = await startMockServer((req, res, body) => {
      capturedUrl = req.url ?? '';
      capturedBody = body;
      res.writeHead(201);
      res.end();
    });
    mockServer = server;
    routeFetch(port);

    const request: CreateIssueLinkRequest = {
      type: { name: 'Blocks' },
      inwardIssue: { key: 'PROJ-2' },
      outwardIssue: { key: 'PROJ-1' },
    };

    await createIssueLink(client, request);
    expect(capturedUrl).toContain('/issueLink');
    expect(JSON.parse(capturedBody)).toEqual(request);
  });
});
