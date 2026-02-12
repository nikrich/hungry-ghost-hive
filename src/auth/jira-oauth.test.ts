// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type Server } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autoRefreshToken,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  fetchAccessibleResources,
  refreshAccessToken,
  startJiraOAuthFlow,
  storeJiraTokens,
  type AccessibleResource,
  type JiraOAuthResult,
  type JiraTokenResponse,
} from './jira-oauth.js';
import { TokenStore } from './token-store.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jira-oauth-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  vi.restoreAllMocks();
});

describe('buildAuthorizationUrl', () => {
  it('should build a valid authorization URL with all required params', () => {
    const url = buildAuthorizationUrl('client-123', 'http://127.0.0.1:3000/callback', 'state-abc');
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://auth.atlassian.com');
    expect(parsed.pathname).toBe('/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/callback');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('should include all required scopes', () => {
    const url = buildAuthorizationUrl('client-123', 'http://localhost/cb', 'state-1');
    const parsed = new URL(url);
    const scopes = parsed.searchParams.get('scope')!.split(' ');

    expect(scopes).toContain('read:jira-work');
    expect(scopes).toContain('write:jira-work');
    expect(scopes).toContain('read:jira-user');
    expect(scopes).toContain('offline_access');
    expect(scopes).toContain('read:confluence-content.all');
  });
});

describe('exchangeCodeForTokens', () => {
  let mockServer: Server;
  let mockPort: number;

  beforeEach(async () => {
    await new Promise<void>(resolve => {
      mockServer = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          const data = JSON.parse(body);
          if (data.code === 'valid-code') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                access_token: 'access-123',
                refresh_token: 'refresh-456',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'read:jira-work write:jira-work',
              } satisfies JiraTokenResponse)
            );
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant' }));
          }
        });
      });
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    mockServer?.close();
  });

  it('should exchange a valid code for tokens', async () => {
    // Mock global fetch to call our local server
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('auth.atlassian.com/oauth/token')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/token`, init);
      }
      return originalFetch(input, init);
    };

    try {
      const tokens = await exchangeCodeForTokens(
        'valid-code',
        'client-id',
        'client-secret',
        'http://localhost/callback'
      );

      expect(tokens.access_token).toBe('access-123');
      expect(tokens.refresh_token).toBe('refresh-456');
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_in).toBe(3600);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should throw on invalid code', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('auth.atlassian.com/oauth/token')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/token`, init);
      }
      return originalFetch(input, init);
    };

    try {
      await expect(
        exchangeCodeForTokens('bad-code', 'client-id', 'client-secret', 'http://localhost/callback')
      ).rejects.toThrow('Token exchange failed (400)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('refreshAccessToken', () => {
  let mockServer: Server;
  let mockPort: number;

  beforeEach(async () => {
    await new Promise<void>(resolve => {
      mockServer = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          const data = JSON.parse(body);
          if (data.grant_type === 'refresh_token' && data.refresh_token === 'valid-refresh') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                access_token: 'new-access-789',
                refresh_token: 'new-refresh-012',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'read:jira-work',
              } satisfies JiraTokenResponse)
            );
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant' }));
          }
        });
      });
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    mockServer?.close();
  });

  it('should refresh token successfully', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('auth.atlassian.com/oauth/token')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/token`, init);
      }
      return originalFetch(input, init);
    };

    try {
      const tokens = await refreshAccessToken('valid-refresh', 'client-id', 'client-secret');
      expect(tokens.access_token).toBe('new-access-789');
      expect(tokens.refresh_token).toBe('new-refresh-012');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should throw on invalid refresh token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('auth.atlassian.com/oauth/token')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/token`, init);
      }
      return originalFetch(input, init);
    };

    try {
      await expect(
        refreshAccessToken('expired-refresh', 'client-id', 'client-secret')
      ).rejects.toThrow('Token refresh failed (401)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('fetchAccessibleResources', () => {
  let mockServer: Server;
  let mockPort: number;

  beforeEach(async () => {
    await new Promise<void>(resolve => {
      mockServer = createServer((req, res) => {
        const auth = req.headers.authorization;
        if (auth === 'Bearer valid-access-token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                id: 'cloud-id-123',
                url: 'https://mysite.atlassian.net',
                name: 'My Site',
                scopes: ['read:jira-work'],
                avatarUrl: 'https://example.com/avatar.png',
              },
            ] satisfies AccessibleResource[])
          );
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
        }
      });
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => {
    mockServer?.close();
  });

  it('should fetch accessible resources with valid token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('api.atlassian.com/oauth/token/accessible-resources')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/resources`, init);
      }
      return originalFetch(input, init);
    };

    try {
      const resources = await fetchAccessibleResources('valid-access-token');
      expect(resources).toHaveLength(1);
      expect(resources[0].id).toBe('cloud-id-123');
      expect(resources[0].url).toBe('https://mysite.atlassian.net');
      expect(resources[0].name).toBe('My Site');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should throw on unauthorized access', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('api.atlassian.com/oauth/token/accessible-resources')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/resources`, init);
      }
      return originalFetch(input, init);
    };

    try {
      await expect(fetchAccessibleResources('invalid-token')).rejects.toThrow(
        'Failed to fetch accessible resources (401)'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('storeJiraTokens', () => {
  it('should store all Jira tokens in .env via TokenStore', async () => {
    const tempDir = createTempDir();
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, '', 'utf-8');

    const store = new TokenStore(envPath);
    const result: JiraOAuthResult = {
      accessToken: 'access-abc',
      refreshToken: 'refresh-def',
      cloudId: 'cloud-789',
      siteUrl: 'https://mycompany.atlassian.net',
      expiresIn: 3600,
    };

    await storeJiraTokens(store, result);

    expect(store.getToken('jira_access')).toBe('access-abc');
    expect(store.getToken('jira_refresh')).toBe('refresh-def');
    expect(store.getToken('jira_cloud_id')).toBe('cloud-789');
    expect(store.getToken('jira_site_url')).toBe('https://mycompany.atlassian.net');
  });
});

describe('autoRefreshToken', () => {
  it('should throw when no refresh token is available', async () => {
    const tempDir = createTempDir();
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, '', 'utf-8');

    const store = new TokenStore(envPath);
    await store.loadFromEnv(envPath);

    await expect(autoRefreshToken(store, 'client-id', 'client-secret')).rejects.toThrow(
      'No Jira refresh token available'
    );
  });

  it('should refresh and store new tokens', async () => {
    const tempDir = createTempDir();
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, 'JIRA_REFRESH_TOKEN=valid-refresh\n', 'utf-8');

    const store = new TokenStore(envPath);
    await store.loadFromEnv(envPath);

    // Mock fetch for the token endpoint
    let mockServer: Server | undefined;
    const mockPort = await new Promise<number>(resolve => {
      mockServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'refreshed-access',
            refresh_token: 'refreshed-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read:jira-work',
          })
        );
      });
      mockServer.listen(0, '127.0.0.1', () => {
        resolve((mockServer!.address() as { port: number }).port);
      });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('auth.atlassian.com/oauth/token')) {
        return originalFetch(`http://127.0.0.1:${mockPort}/token`, init);
      }
      return originalFetch(input, init);
    };

    try {
      const newAccessToken = await autoRefreshToken(store, 'client-id', 'client-secret');
      expect(newAccessToken).toBe('refreshed-access');
      expect(store.getToken('jira_access')).toBe('refreshed-access');
      expect(store.getToken('jira_refresh')).toBe('refreshed-refresh');
    } finally {
      globalThis.fetch = originalFetch;
      mockServer?.close();
    }
  });
});

describe('startJiraOAuthFlow', () => {
  it('should complete the full OAuth flow via ephemeral server', async () => {
    // Create mock Atlassian token endpoint
    let tokenServer: Server | undefined;
    const tokenPort = await new Promise<number>(resolve => {
      tokenServer = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1`);
        if (url.pathname === '/token') {
          let body = '';
          req.on('data', chunk => (body += chunk));
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                access_token: 'flow-access-token',
                refresh_token: 'flow-refresh-token',
                token_type: 'Bearer',
                expires_in: 3600,
                scope: 'read:jira-work',
              })
            );
          });
        } else if (url.pathname === '/resources') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                id: 'flow-cloud-id',
                url: 'https://flowsite.atlassian.net',
                name: 'Flow Site',
                scopes: ['read:jira-work'],
                avatarUrl: 'https://example.com/avatar.png',
              },
            ])
          );
        }
      });
      tokenServer.listen(0, '127.0.0.1', () => {
        resolve((tokenServer!.address() as { port: number }).port);
      });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('auth.atlassian.com/oauth/token')) {
        return originalFetch(`http://127.0.0.1:${tokenPort}/token`, init);
      }
      if (url.includes('api.atlassian.com/oauth/token/accessible-resources')) {
        return originalFetch(`http://127.0.0.1:${tokenPort}/resources`, init);
      }
      return originalFetch(input, init);
    };

    try {
      let capturedAuthUrl = '';
      const resultPromise = startJiraOAuthFlow({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        port: 0,
        timeoutMs: 10_000,
        openBrowser: async (url: string) => {
          capturedAuthUrl = url;
          // Simulate the browser completing the OAuth flow by hitting the callback
          const parsed = new URL(url);
          const state = parsed.searchParams.get('state')!;
          const redirectUri = parsed.searchParams.get('redirect_uri')!;
          // Small delay to ensure server is listening
          await new Promise(r => setTimeout(r, 50));
          await fetch(`${redirectUri}?code=test-auth-code&state=${state}`);
        },
      });

      const result = await resultPromise;

      expect(result.accessToken).toBe('flow-access-token');
      expect(result.refreshToken).toBe('flow-refresh-token');
      expect(result.cloudId).toBe('flow-cloud-id');
      expect(result.siteUrl).toBe('https://flowsite.atlassian.net');
      expect(result.expiresIn).toBe(3600);

      // Verify auth URL was correct
      expect(capturedAuthUrl).toContain('auth.atlassian.com/authorize');
      expect(capturedAuthUrl).toContain('test-client-id');
    } finally {
      globalThis.fetch = originalFetch;
      tokenServer?.close();
    }
  });

  it('should reject on timeout', async () => {
    await expect(
      startJiraOAuthFlow({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        port: 0,
        timeoutMs: 100,
        openBrowser: async () => {
          // Don't simulate callback — let it time out
        },
      })
    ).rejects.toThrow('OAuth flow timed out');
  });

  it('should reject on OAuth error response', async () => {
    const resultPromise = startJiraOAuthFlow({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      port: 0,
      timeoutMs: 5_000,
      openBrowser: async (url: string) => {
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get('redirect_uri')!;
        await new Promise(r => setTimeout(r, 50));
        await fetch(`${redirectUri}?error=access_denied&error_description=User+denied+access`);
      },
    });

    await expect(resultPromise).rejects.toThrow('Jira OAuth error: User denied access');
  });

  it('should reject on state mismatch', async () => {
    const resultPromise = startJiraOAuthFlow({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      port: 0,
      timeoutMs: 5_000,
      openBrowser: async (url: string) => {
        const parsed = new URL(url);
        const redirectUri = parsed.searchParams.get('redirect_uri')!;
        await new Promise(r => setTimeout(r, 50));
        await fetch(`${redirectUri}?code=some-code&state=wrong-state`);
      },
    });

    await expect(resultPromise).rejects.toThrow('Invalid OAuth callback');
  });
});
