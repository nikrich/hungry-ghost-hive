// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../registry.js';
import { JiraAuthConnector, register } from './jira.js';

// Mock the underlying modules
vi.mock('../../auth/jira-oauth.js', () => ({
  startJiraOAuthFlow: vi.fn(),
  storeJiraTokens: vi.fn(),
}));

vi.mock('../../auth/token-store.js', () => ({
  TokenStore: vi.fn().mockImplementation(() => ({})),
}));

describe('JiraAuthConnector', () => {
  let connector: JiraAuthConnector;
  const originalEnv = process.env;

  beforeEach(() => {
    connector = new JiraAuthConnector();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should have provider set to "jira"', () => {
    expect(connector.provider).toBe('jira');
  });

  it('should return "Jira" from getProviderName', () => {
    expect(connector.getProviderName()).toBe('Jira');
  });

  describe('authenticate', () => {
    it('should succeed with valid credentials', async () => {
      const { startJiraOAuthFlow } = await import('../../auth/jira-oauth.js');
      vi.mocked(startJiraOAuthFlow).mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        cloudId: 'cloud-789',
        siteUrl: 'https://test.atlassian.net',
        expiresIn: 3600,
      });

      const result = await connector.authenticate({
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
      });

      expect(startJiraOAuthFlow).toHaveBeenCalledWith({
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        openBrowser: undefined,
      });
      expect(result).toEqual({
        success: true,
        provider: 'jira',
        message: 'Authenticated with Jira site (cloud ID: cloud-789)',
      });
    });

    it('should use env vars when no options provided', async () => {
      process.env.JIRA_CLIENT_ID = 'env-client-id';
      process.env.JIRA_CLIENT_SECRET = 'env-secret';

      const { startJiraOAuthFlow } = await import('../../auth/jira-oauth.js');
      vi.mocked(startJiraOAuthFlow).mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        cloudId: 'cloud-abc',
        siteUrl: 'https://test.atlassian.net',
        expiresIn: 3600,
      });

      const result = await connector.authenticate();

      expect(startJiraOAuthFlow).toHaveBeenCalledWith({
        clientId: 'env-client-id',
        clientSecret: 'env-secret',
        openBrowser: undefined,
      });
      expect(result.success).toBe(true);
    });

    it('should return failure when no clientId available', async () => {
      delete process.env.JIRA_CLIENT_ID;
      delete process.env.JIRA_CLIENT_SECRET;

      const result = await connector.authenticate();

      expect(result).toEqual({
        success: false,
        provider: 'jira',
        message:
          'Jira Client ID and Client Secret are required. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET or pass them in options.',
      });
    });

    it('should return failure when only clientId but no secret', async () => {
      delete process.env.JIRA_CLIENT_ID;
      delete process.env.JIRA_CLIENT_SECRET;

      const result = await connector.authenticate({ clientId: 'id-only' });

      expect(result.success).toBe(false);
    });

    it('should return failure on auth error', async () => {
      const { startJiraOAuthFlow } = await import('../../auth/jira-oauth.js');
      vi.mocked(startJiraOAuthFlow).mockRejectedValue(new Error('OAuth flow timed out'));

      const result = await connector.authenticate({
        clientId: 'cid',
        clientSecret: 'sec',
      });

      expect(result).toEqual({
        success: false,
        provider: 'jira',
        message: 'Jira auth failed: OAuth flow timed out',
      });
    });
  });

  describe('validateCredentials', () => {
    it('should return true when both tokens are present', async () => {
      process.env.JIRA_ACCESS_TOKEN = 'access-token';
      process.env.JIRA_CLOUD_ID = 'cloud-id';

      const result = await connector.validateCredentials();
      expect(result).toBe(true);
    });

    it('should return false when access token is missing', async () => {
      delete process.env.JIRA_ACCESS_TOKEN;
      process.env.JIRA_CLOUD_ID = 'cloud-id';

      const result = await connector.validateCredentials();
      expect(result).toBe(false);
    });

    it('should return false when cloud ID is missing', async () => {
      process.env.JIRA_ACCESS_TOKEN = 'access-token';
      delete process.env.JIRA_CLOUD_ID;

      const result = await connector.validateCredentials();
      expect(result).toBe(false);
    });

    it('should return false when both are missing', async () => {
      delete process.env.JIRA_ACCESS_TOKEN;
      delete process.env.JIRA_CLOUD_ID;

      const result = await connector.validateCredentials();
      expect(result).toBe(false);
    });
  });
});

describe('register', () => {
  afterEach(() => {
    registry.reset();
  });

  it('should register the Jira auth connector', () => {
    register();

    const connector = registry.getAuth('jira');
    expect(connector).toBeInstanceOf(JiraAuthConnector);
    expect(connector?.provider).toBe('jira');
  });

  it('should lazily instantiate the connector', () => {
    register();

    const providers = registry.listAuthProviders();
    expect(providers).toContain('jira');
  });
});
