// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer, type Server } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '../../auth/token-store.js';
import { JiraApiError, JiraClient } from './client.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jira-client-test-'));
  tempDirs.push(dir);
  return dir;
}

function createTokenStore(tokens: Record<string, string>): { store: TokenStore; envPath: string } {
  const dir = createTempDir();
  const envPath = join(dir, '.env');
  const content = Object.entries(tokens)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  writeFileSync(envPath, content + '\n', 'utf-8');
  const store = new TokenStore(envPath);
  return { store, envPath };
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  vi.restoreAllMocks();
});

describe('JiraClient', () => {
  describe('getBaseUrl', () => {
    it('should build the correct REST API base URL from cloud ID', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'test-access',
        JIRA_CLOUD_ID: 'cloud-123',
      });
      await store.loadFromEnv(envPath);

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      expect(client.getBaseUrl()).toBe('https://api.atlassian.com/ex/jira/cloud-123/rest/api/3');
    });

    it('should throw when cloud ID is missing', () => {
      const { store } = createTokenStore({});

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      expect(() => client.getBaseUrl()).toThrow('No Jira cloud ID configured');
    });
  });

  describe('getAgileBaseUrl', () => {
    it('should build the correct Agile API base URL from cloud ID', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'test-access',
        JIRA_CLOUD_ID: 'cloud-456',
      });
      await store.loadFromEnv(envPath);

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      expect(client.getAgileBaseUrl()).toBe(
        'https://api.atlassian.com/ex/jira/cloud-456/rest/agile/1.0'
      );
    });
  });

  describe('request', () => {
    let mockServer: Server;
    let mockPort: number;

    afterEach(() => {
      mockServer?.close();
    });

    it('should make authenticated GET request', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      let capturedAuth = '';
      mockServer = createServer((req, res) => {
        capturedAuth = req.headers.authorization ?? '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: '1', key: 'TEST-1' }));
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      const result = await client.request<{ id: string; key: string }>('/issue/TEST-1');
      expect(result.id).toBe('1');
      expect(result.key).toBe('TEST-1');
      expect(capturedAuth).toBe('Bearer my-token');
    });

    it('should make authenticated POST request with body', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      let capturedBody = '';
      let capturedContentType = '';
      mockServer = createServer((req, res) => {
        capturedContentType = req.headers['content-type'] ?? '';
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          capturedBody = body;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: '2', key: 'TEST-2', self: 'https://...' }));
        });
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      const result = await client.request<{ id: string; key: string }>('/issue', {
        method: 'POST',
        body: JSON.stringify({ fields: { summary: 'Test' } }),
      });
      expect(result.key).toBe('TEST-2');
      expect(capturedContentType).toBe('application/json');
      expect(JSON.parse(capturedBody)).toEqual({ fields: { summary: 'Test' } });
    });

    it('should handle 204 No Content responses', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      mockServer = createServer((_req, res) => {
        res.writeHead(204);
        res.end();
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      const result = await client.request<void>('/issue/TEST-1', { method: 'PUT', body: '{}' });
      expect(result).toBeUndefined();
    });

    it('should throw JiraApiError on non-OK responses', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      mockServer = createServer((_req, res) => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errorMessages: ['Issue does not exist'] }));
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      try {
        await client.request('/issue/NONEXISTENT-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraApiError);
        const apiErr = err as JiraApiError;
        expect(apiErr.statusCode).toBe(404);
        expect(apiErr.responseBody).toContain('Issue does not exist');
      }
    });

    it('should throw when access token is missing', async () => {
      const { store } = createTokenStore({
        JIRA_CLOUD_ID: 'cloud-abc',
      });

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      await expect(client.request('/issue/TEST-1')).rejects.toThrow(
        'No Jira access token available'
      );
    });

    it('should refresh token on 401 and retry', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'expired-token',
        JIRA_REFRESH_TOKEN: 'valid-refresh',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      let requestCount = 0;

      // Mock Jira API server
      mockServer = createServer((req, res) => {
        requestCount++;
        const auth = req.headers.authorization;
        if (auth === 'Bearer refreshed-token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: '1', key: 'TEST-1' }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
        }
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      // Mock token refresh server
      let refreshServer: Server | undefined;
      const refreshPort = await new Promise<number>(resolve => {
        refreshServer = createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'refreshed-token',
              refresh_token: 'new-refresh',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'read:jira-work',
            })
          );
        });
        refreshServer.listen(0, '127.0.0.1', () => {
          resolve((refreshServer!.address() as { port: number }).port);
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        if (url.includes('auth.atlassian.com/oauth/token')) {
          return originalFetch(`http://127.0.0.1:${refreshPort}/token`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      const result = await client.request<{ id: string; key: string }>('/issue/TEST-1');
      expect(result.key).toBe('TEST-1');
      expect(requestCount).toBe(2); // first 401, then retry with refreshed token
      expect(store.getToken('jira_access')).toBe('refreshed-token');

      refreshServer?.close();
    });

    it('should not retry token refresh more than once', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'expired-token',
        JIRA_REFRESH_TOKEN: 'bad-refresh',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      // Always return 401
      mockServer = createServer((_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      // Token refresh also fails
      let refreshServer: Server | undefined;
      const refreshPort = await new Promise<number>(resolve => {
        refreshServer = createServer((_req, res) => {
          // Return a new token, but the API still rejects it
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'still-bad-token',
              refresh_token: 'still-bad-refresh',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'read:jira-work',
            })
          );
        });
        refreshServer.listen(0, '127.0.0.1', () => {
          resolve((refreshServer!.address() as { port: number }).port);
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        if (url.includes('auth.atlassian.com/oauth/token')) {
          return originalFetch(`http://127.0.0.1:${refreshPort}/token`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
      });

      try {
        await client.request('/issue/TEST-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraApiError);
        expect((err as JiraApiError).statusCode).toBe(401);
      }

      refreshServer?.close();
    });

    it('should retry on 429 with exponential backoff', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      let requestCount = 0;
      mockServer = createServer((_req, res) => {
        requestCount++;
        if (requestCount < 3) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
          res.end(JSON.stringify({ error: 'rate limited' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: '1', key: 'TEST-1' }));
        }
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
        maxRetries: 3,
        baseDelayMs: 10,
      });

      const result = await client.request<{ id: string; key: string }>('/issue/TEST-1');
      expect(result.key).toBe('TEST-1');
      expect(requestCount).toBe(3); // 2x 429, then success
    });

    it('should respect Retry-After header on 429', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      const timestamps: number[] = [];
      let requestCount = 0;
      mockServer = createServer((_req, res) => {
        timestamps.push(Date.now());
        requestCount++;
        if (requestCount === 1) {
          // Return Retry-After: 0 (minimal delay for test speed)
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
          res.end(JSON.stringify({ error: 'rate limited' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: '1', key: 'TEST-1' }));
        }
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
        maxRetries: 3,
        baseDelayMs: 5000, // high base delay to prove Retry-After takes precedence
      });

      const result = await client.request<{ id: string; key: string }>('/issue/TEST-1');
      expect(result.key).toBe('TEST-1');
      expect(requestCount).toBe(2);
    });

    it('should throw after exhausting 429 retries', async () => {
      const { store, envPath } = createTokenStore({
        JIRA_ACCESS_TOKEN: 'my-token',
        JIRA_CLOUD_ID: 'cloud-abc',
      });
      await store.loadFromEnv(envPath);

      mockServer = createServer((_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
        res.end(JSON.stringify({ error: 'rate limited' }));
      });

      await new Promise<void>(resolve => {
        mockServer.listen(0, '127.0.0.1', () => {
          mockPort = (mockServer.address() as { port: number }).port;
          resolve();
        });
      });

      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('api.atlassian.com')) {
          const path = new URL(url).pathname;
          return originalFetch(`http://127.0.0.1:${mockPort}${path}`, init);
        }
        return originalFetch(input, init);
      };

      const client = new JiraClient({
        tokenStore: store,
        clientId: 'cid',
        clientSecret: 'csecret',
        maxRetries: 2,
        baseDelayMs: 10,
      });

      try {
        await client.request('/issue/TEST-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JiraApiError);
        expect((err as JiraApiError).statusCode).toBe(429);
      }
    });
  });
});
