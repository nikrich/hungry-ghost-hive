// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IncomingMessage, ServerResponse } from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tmux/manager.js', () => ({
  isManagerRunning: vi.fn(() => Promise.resolve(false)),
  startManager: vi.fn(() => Promise.resolve(true)),
  stopManager: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    version: 1,
    integrations: {
      source_control: { provider: 'github' },
      project_management: { provider: 'jira' },
      autonomy: { level: 'supervised' },
    },
    github: { base_branch: 'main' },
    scaling: { max_agents: 5 },
    manager: {
      fast_poll_interval: 10,
      slow_poll_interval: 60,
      auditor_enabled: true,
    },
  })),
}));

vi.mock('../../db/client.js', () => ({
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

vi.mock('../../db/lock.js', () => ({
  acquireLock: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getTeamByName: vi.fn(() => undefined),
  createTeam: vi.fn((_db, opts) => ({
    id: 'team-1',
    name: opts.name,
    repo_url: opts.repoUrl,
    repo_path: opts.repoPath,
  })),
}));

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
}));

import { isManagerRunning, startManager, stopManager } from '../../tmux/manager.js';
import { Router } from '../router.js';
import { registerSystemRoutes } from './system.js';

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

function createMockReq(body?: Record<string, unknown>): IncomingMessage {
  const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
  const req = {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  } as unknown as IncomingMessage;
  return req;
}

describe('system handlers', () => {
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new Router();
    registerSystemRoutes(router, '/test/.hive', '/test');
  });

  describe('manager status', () => {
    it('GET /api/v1/manager/status returns running state', async () => {
      const match = router.match('GET', '/api/v1/manager/status');
      expect(match).not.toBeNull();

      const res = createMockRes();
      await match!.handler(createMockReq(), res, {}, {});

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.running).toBe(false);
      expect(isManagerRunning).toHaveBeenCalledWith('/test/.hive');
    });

    it('GET /api/v1/manager/status handles errors gracefully', async () => {
      vi.mocked(isManagerRunning).mockRejectedValueOnce(new Error('tmux not found'));

      const match = router.match('GET', '/api/v1/manager/status');
      const res = createMockRes();
      await match!.handler(createMockReq(), res, {}, {});

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.running).toBe(false);
      expect(body.error).toBeDefined();
    });
  });

  describe('manager start', () => {
    it('POST /api/v1/manager/start starts manager when not running', async () => {
      const match = router.match('POST', '/api/v1/manager/start');
      expect(match).not.toBeNull();

      const res = createMockRes();
      await match!.handler(createMockReq(), res, {}, {});

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.started).toBe(true);
      expect(startManager).toHaveBeenCalledWith(60, '/test/.hive');
    });

    it('POST /api/v1/manager/start returns already running when active', async () => {
      vi.mocked(isManagerRunning).mockResolvedValueOnce(true);

      const match = router.match('POST', '/api/v1/manager/start');
      const res = createMockRes();
      await match!.handler(createMockReq(), res, {}, {});

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.started).toBe(false);
      expect(body.message).toContain('already running');
      expect(startManager).not.toHaveBeenCalled();
    });
  });

  describe('manager stop', () => {
    it('POST /api/v1/manager/stop stops manager', async () => {
      const match = router.match('POST', '/api/v1/manager/stop');
      expect(match).not.toBeNull();

      const res = createMockRes();
      await match!.handler(createMockReq(), res, {}, {});

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.stopped).toBe(true);
      expect(stopManager).toHaveBeenCalledWith('/test/.hive');
    });
  });

  describe('add repo / create team', () => {
    it('POST /api/v1/teams returns 400 when url or team missing', async () => {
      const match = router.match('POST', '/api/v1/teams');
      expect(match).not.toBeNull();

      const res = createMockRes();
      await match!.handler(createMockReq({ url: 'https://github.com/test/repo' }), res, {}, {});

      expect(res._status).toBe(400);
      const body = JSON.parse(res._body);
      expect(body.error).toContain('required');
    });

    it('POST /api/v1/teams returns 409 when team already exists', async () => {
      const { getTeamByName } = await import('../../db/queries/teams.js');
      vi.mocked(getTeamByName).mockReturnValueOnce({
        id: 'team-1',
        name: 'alpha',
        repo_url: 'https://github.com/test/repo',
        repo_path: 'repos/repo',
        created_at: '',
      });

      const match = router.match('POST', '/api/v1/teams');
      const res = createMockRes();
      await match!.handler(
        createMockReq({ url: 'https://github.com/test/repo', team: 'alpha' }),
        res,
        {},
        {}
      );

      expect(res._status).toBe(409);
      const body = JSON.parse(res._body);
      expect(body.error).toContain('already exists');
    });
  });

  describe('config', () => {
    it('GET /api/v1/config returns non-sensitive config summary', async () => {
      const match = router.match('GET', '/api/v1/config');
      expect(match).not.toBeNull();

      const res = createMockRes();
      await match!.handler(createMockReq(), res, {}, {});

      expect(res._status).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.version).toBe(1);
      expect(body.integrations.source_control).toBe('github');
      expect(body.github.base_branch).toBe('main');
      expect(body.manager.auditor_enabled).toBe(true);
    });
  });
});
