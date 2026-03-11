// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({
  getReadOnlyDatabase: vi.fn(() => ({
    db: {},
    close: vi.fn(),
  })),
}));

vi.mock('../../db/queries/stories.js', () => ({
  getAllStories: vi.fn(() => [{ id: 'STORY-ABC', title: 'Test story', status: 'in_progress' }]),
  getStoriesByStatus: vi.fn(() => [
    { id: 'STORY-ABC', title: 'Test story', status: 'in_progress' },
  ]),
  getStoryById: vi.fn((_, id) => {
    if (id === 'STORY-ABC')
      return { id: 'STORY-ABC', title: 'Test story', status: 'in_progress', description: '' };
    return undefined;
  }),
  getStoryDependencies: vi.fn(() => []),
  getStoriesDependingOn: vi.fn(() => []),
}));

vi.mock('../../db/queries/logs.js', () => ({
  getLogsByStory: vi.fn(() => []),
}));

import { Router } from '../router.js';
import { registerStoryRoutes } from './stories.js';

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

describe('story handlers', () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
    registerStoryRoutes(router, '/test/.hive');
  });

  it('GET /api/v1/stories returns all stories', async () => {
    const match = router.match('GET', '/api/v1/stories');
    expect(match).not.toBeNull();

    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, {}, {});

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('STORY-ABC');
  });

  it('GET /api/v1/stories/:id returns story with deps', async () => {
    const match = router.match('GET', '/api/v1/stories/STORY-ABC');
    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, match!.params, {});

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.id).toBe('STORY-ABC');
    expect(body.dependencies).toBeDefined();
    expect(body.dependents).toBeDefined();
    expect(body.logs).toBeDefined();
  });

  it('GET /api/v1/stories/:id returns 404 for unknown story', async () => {
    const match = router.match('GET', '/api/v1/stories/STORY-MISSING');
    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, match!.params, {});

    expect(res._status).toBe(404);
  });
});
