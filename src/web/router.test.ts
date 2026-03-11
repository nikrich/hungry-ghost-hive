// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import { parseQuery, Router } from './router.js';

describe('Router', () => {
  it('should match static paths', () => {
    const router = new Router();
    const handler = vi.fn();
    router.get('/api/v1/agents', handler);

    const result = router.match('GET', '/api/v1/agents');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({});
  });

  it('should match paths with params', () => {
    const router = new Router();
    const handler = vi.fn();
    router.get('/api/v1/agents/:id', handler);

    const result = router.match('GET', '/api/v1/agents/agent-123');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ id: 'agent-123' });
  });

  it('should match multiple params', () => {
    const router = new Router();
    const handler = vi.fn();
    router.get('/api/v1/:type/:id', handler);

    const result = router.match('GET', '/api/v1/stories/STORY-ABC');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ type: 'stories', id: 'STORY-ABC' });
  });

  it('should differentiate methods', () => {
    const router = new Router();
    const getHandler = vi.fn();
    const postHandler = vi.fn();
    router.get('/api/v1/items', getHandler);
    router.post('/api/v1/items', postHandler);

    const getResult = router.match('GET', '/api/v1/items');
    expect(getResult).not.toBeNull();
    expect(getResult!.handler).toBe(getHandler);

    const postResult = router.match('POST', '/api/v1/items');
    expect(postResult).not.toBeNull();
    expect(postResult!.handler).toBe(postHandler);
  });

  it('should return null for unmatched paths', () => {
    const router = new Router();
    router.get('/api/v1/agents', vi.fn());

    expect(router.match('GET', '/api/v1/stories')).toBeNull();
    expect(router.match('POST', '/api/v1/agents')).toBeNull();
  });

  it('should decode URI components in params', () => {
    const router = new Router();
    router.get('/api/v1/agents/:id', vi.fn());

    const result = router.match('GET', '/api/v1/agents/agent%20123');
    expect(result).not.toBeNull();
    expect(result!.params.id).toBe('agent 123');
  });
});

describe('parseQuery', () => {
  it('should parse query parameters', () => {
    expect(parseQuery('/api?status=pending&limit=10')).toEqual({
      status: 'pending',
      limit: '10',
    });
  });

  it('should return empty object for no query', () => {
    expect(parseQuery('/api')).toEqual({});
  });

  it('should handle empty values', () => {
    expect(parseQuery('/api?key=')).toEqual({ key: '' });
  });

  it('should decode query values', () => {
    expect(parseQuery('/api?q=hello%20world')).toEqual({ q: 'hello world' });
  });
});
