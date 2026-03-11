// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({
  getReadOnlyDatabase: vi.fn(() => ({
    db: {},
    close: vi.fn(),
  })),
}));

vi.mock('../../db/queries/agents.js', () => ({
  getActiveAgents: vi.fn(() => [
    { id: 'tech-lead', type: 'tech_lead', status: 'working', team_id: 'team-1' },
  ]),
  getAgentById: vi.fn((_, id) => {
    if (id === 'tech-lead')
      return { id: 'tech-lead', type: 'tech_lead', status: 'working', team_id: 'team-1' };
    return undefined;
  }),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(() => [{ id: 'team-1', name: 'alpha', repo_url: 'https://github.com/test' }]),
}));

vi.mock('../../db/queries/logs.js', () => ({
  getLogsByAgent: vi.fn(() => []),
}));

import { Router } from '../router.js';
import { registerAgentRoutes } from './agents.js';

function createMockRes(): ServerResponse & { _body: string; _status: number } {
  const res = {
    statusCode: 200,
    _body: '',
    _status: 200,
    setHeader: vi.fn(),
    end: vi.fn(function (
      this: { _body: string; _status: number; statusCode: number },
      data: string
    ) {
      this._body = data;
      this._status = this.statusCode;
    }),
  } as unknown as ServerResponse & { _body: string; _status: number };
  return res;
}

describe('agent handlers', () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
    registerAgentRoutes(router, '/test/.hive');
  });

  it('GET /api/v1/agents returns agents with team info', async () => {
    const match = router.match('GET', '/api/v1/agents');
    expect(match).not.toBeNull();

    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, {}, {});

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('tech-lead');
    expect(body[0].team).toBeDefined();
    expect(body[0].team.name).toBe('alpha');
  });

  it('GET /api/v1/agents/:id returns agent with logs', async () => {
    const match = router.match('GET', '/api/v1/agents/tech-lead');
    expect(match).not.toBeNull();

    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, match!.params, {});

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.id).toBe('tech-lead');
    expect(body.logs).toBeDefined();
  });

  it('GET /api/v1/agents/:id returns 404 for unknown agent', async () => {
    const match = router.match('GET', '/api/v1/agents/unknown');
    expect(match).not.toBeNull();

    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, match!.params, {});

    expect(res._status).toBe(404);
  });
});
