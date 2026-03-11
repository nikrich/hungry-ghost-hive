// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock database and all query modules before importing server
vi.mock('../db/client.js', () => ({
  getReadOnlyDatabase: vi.fn(() => ({
    db: {},
    close: vi.fn(),
  })),
  getDatabase: vi.fn(() => ({
    db: {},
    close: vi.fn(),
    save: vi.fn(),
  })),
}));

vi.mock('../db/queries/agents.js', () => ({
  getActiveAgents: vi.fn(() => []),
  getAgentById: vi.fn(),
}));
vi.mock('../db/queries/stories.js', () => ({
  getAllStories: vi.fn(() => []),
  getStoriesByStatus: vi.fn(() => []),
  getStoryById: vi.fn(),
  getStoryDependencies: vi.fn(() => []),
  getStoriesDependingOn: vi.fn(() => []),
  getStoryCounts: vi.fn(() => ({
    draft: 0,
    estimated: 0,
    planned: 0,
    in_progress: 0,
    review: 0,
    qa: 0,
    qa_failed: 0,
    pr_submitted: 0,
    merged: 0,
  })),
}));
vi.mock('../db/queries/escalations.js', () => ({
  getAllEscalations: vi.fn(() => []),
  getPendingEscalations: vi.fn(() => []),
  getEscalationById: vi.fn(),
  resolveEscalation: vi.fn(),
  acknowledgeEscalation: vi.fn(),
}));
vi.mock('../db/queries/logs.js', () => ({
  getRecentLogs: vi.fn(() => []),
  getLogsSince: vi.fn(() => []),
  getLogsByAgent: vi.fn(() => []),
  getLogsByStory: vi.fn(() => []),
}));
vi.mock('../db/queries/pull-requests.js', () => ({
  getAllPullRequests: vi.fn(() => []),
  getPrioritizedMergeQueue: vi.fn(() => []),
}));
vi.mock('../db/queries/requirements.js', () => ({
  getAllRequirements: vi.fn(() => []),
  getRequirementById: vi.fn(),
  createRequirement: vi.fn(),
  getStoriesByRequirement: vi.fn(() => []),
}));
vi.mock('../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(() => []),
}));
vi.mock('../db/lock.js', () => ({
  acquireLock: vi.fn(() => vi.fn()),
}));

import { WebDashboardServer } from './server.js';

describe('WebDashboardServer', () => {
  let server: WebDashboardServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new WebDashboardServer(
      { host: '127.0.0.1', port: 0, refresh_interval_ms: 60000 },
      '/test/.hive'
    );
  });

  it('should create without errors', () => {
    expect(server).toBeDefined();
  });

  it('should start and stop', async () => {
    // Use port 0 to let OS assign a free port
    await server.start();
    expect(server.url).toContain('127.0.0.1');
    await server.stop();
  });

  it('should serve the dashboard HTML at /', async () => {
    await server.start();
    try {
      const res = await fetch(`${server.url}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Hive Orchestrator');
    } finally {
      await server.stop();
    }
  });

  it('should serve API endpoints', async () => {
    await server.start();
    try {
      const res = await fetch(`${server.url}/api/v1/agents`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('should return 404 for unknown API paths', async () => {
    await server.start();
    try {
      const res = await fetch(`${server.url}/api/v1/nonexistent`);
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('should enforce auth when configured', async () => {
    const authedServer = new WebDashboardServer(
      { host: '127.0.0.1', port: 0, refresh_interval_ms: 60000, auth_token: 'test-secret' },
      '/test/.hive'
    );
    await authedServer.start();
    try {
      // No auth header
      const noAuth = await fetch(`${authedServer.url}/api/v1/agents`);
      expect(noAuth.status).toBe(401);

      // Wrong auth
      const wrongAuth = await fetch(`${authedServer.url}/api/v1/agents`, {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(wrongAuth.status).toBe(401);

      // Correct auth
      const goodAuth = await fetch(`${authedServer.url}/api/v1/agents`, {
        headers: { Authorization: 'Bearer test-secret' },
      });
      expect(goodAuth.status).toBe(200);
    } finally {
      await authedServer.stop();
    }
  });

  it('should handle CORS preflight', async () => {
    await server.start();
    try {
      const res = await fetch(`${server.url}/api/v1/agents`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    } finally {
      await server.stop();
    }
  });
});
