// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IncomingMessage } from 'http';
import { describe, expect, it } from 'vitest';
import { authorize } from './auth.js';

function mockReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as IncomingMessage;
}

describe('authorize', () => {
  it('should allow all requests when no auth token configured', () => {
    expect(authorize(mockReq(), undefined)).toBe(true);
    expect(authorize(mockReq('Bearer anything'), undefined)).toBe(true);
  });

  it('should reject requests without auth header when token is set', () => {
    expect(authorize(mockReq(), 'secret')).toBe(false);
  });

  it('should reject requests with wrong token', () => {
    expect(authorize(mockReq('Bearer wrong'), 'secret')).toBe(false);
  });

  it('should accept requests with correct Bearer token', () => {
    expect(authorize(mockReq('Bearer secret'), 'secret')).toBe(true);
  });

  it('should reject non-Bearer auth schemes', () => {
    expect(authorize(mockReq('Basic secret'), 'secret')).toBe(false);
  });
});
