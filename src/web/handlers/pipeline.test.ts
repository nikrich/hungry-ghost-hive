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
  getStoryCounts: vi.fn(() => ({
    draft: 2,
    estimated: 1,
    planned: 3,
    in_progress: 2,
    review: 1,
    qa: 0,
    qa_failed: 0,
    pr_submitted: 1,
    merged: 5,
  })),
}));

import { Router } from '../router.js';
import { registerPipelineRoutes } from './pipeline.js';

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

describe('pipeline handler', () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
    registerPipelineRoutes(router, '/test/.hive');
  });

  it('GET /api/v1/pipeline returns story counts', async () => {
    const match = router.match('GET', '/api/v1/pipeline');
    expect(match).not.toBeNull();

    const res = createMockRes();
    await match!.handler({} as IncomingMessage, res, {}, {});

    expect(res._status).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.draft).toBe(2);
    expect(body.merged).toBe(5);
    expect(body.in_progress).toBe(2);
  });
});
