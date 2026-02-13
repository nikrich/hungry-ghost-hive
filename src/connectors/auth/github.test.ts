// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../registry.js';
import { GitHubAuthConnector, register } from './github.js';

// Mock the underlying modules
vi.mock('../../auth/github-oauth.js', () => ({
  runGitHubDeviceFlow: vi.fn(),
}));

vi.mock('../../git/github.js', () => ({
  isGitHubAuthenticated: vi.fn(),
}));

describe('GitHubAuthConnector', () => {
  let connector: GitHubAuthConnector;
  const originalEnv = process.env;

  beforeEach(() => {
    connector = new GitHubAuthConnector();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should have provider set to "github"', () => {
    expect(connector.provider).toBe('github');
  });

  it('should return "GitHub" from getProviderName', () => {
    expect(connector.getProviderName()).toBe('GitHub');
  });

  describe('authenticate', () => {
    it('should succeed with valid clientId option', async () => {
      const { runGitHubDeviceFlow } = await import('../../auth/github-oauth.js');
      vi.mocked(runGitHubDeviceFlow).mockResolvedValue({
        token: 'ghp_test123',
        username: 'testuser',
      });

      const result = await connector.authenticate({ clientId: 'test-client-id' });

      expect(runGitHubDeviceFlow).toHaveBeenCalledWith({
        clientId: 'test-client-id',
        rootDir: undefined,
      });
      expect(result).toEqual({
        success: true,
        provider: 'github',
        message: 'Authenticated as testuser',
      });
    });

    it('should use GITHUB_CLIENT_ID from env when no option provided', async () => {
      process.env.GITHUB_CLIENT_ID = 'env-client-id';

      const { runGitHubDeviceFlow } = await import('../../auth/github-oauth.js');
      vi.mocked(runGitHubDeviceFlow).mockResolvedValue({
        token: 'ghp_test123',
        username: 'envuser',
      });

      const result = await connector.authenticate();

      expect(runGitHubDeviceFlow).toHaveBeenCalledWith({
        clientId: 'env-client-id',
        rootDir: undefined,
      });
      expect(result.success).toBe(true);
    });

    it('should pass rootDir option through', async () => {
      const { runGitHubDeviceFlow } = await import('../../auth/github-oauth.js');
      vi.mocked(runGitHubDeviceFlow).mockResolvedValue({
        token: 'ghp_test123',
        username: 'testuser',
      });

      await connector.authenticate({ clientId: 'cid', rootDir: '/my/project' });

      expect(runGitHubDeviceFlow).toHaveBeenCalledWith({
        clientId: 'cid',
        rootDir: '/my/project',
      });
    });

    it('should return failure when no clientId available', async () => {
      delete process.env.GITHUB_CLIENT_ID;

      const result = await connector.authenticate();

      expect(result).toEqual({
        success: false,
        provider: 'github',
        message: 'GitHub Client ID is required. Set GITHUB_CLIENT_ID or pass clientId in options.',
      });
    });

    it('should return failure on auth error', async () => {
      const { runGitHubDeviceFlow } = await import('../../auth/github-oauth.js');
      vi.mocked(runGitHubDeviceFlow).mockRejectedValue(new Error('Device code expired'));

      const result = await connector.authenticate({ clientId: 'test-client-id' });

      expect(result).toEqual({
        success: false,
        provider: 'github',
        message: 'GitHub auth failed: Device code expired',
      });
    });
  });

  describe('validateCredentials', () => {
    it('should return true when authenticated via token', async () => {
      const { isGitHubAuthenticated } = await import('../../git/github.js');
      vi.mocked(isGitHubAuthenticated).mockResolvedValue({
        authenticated: true,
        method: 'token',
      });

      const result = await connector.validateCredentials();
      expect(result).toBe(true);
    });

    it('should return true when authenticated via gh CLI', async () => {
      const { isGitHubAuthenticated } = await import('../../git/github.js');
      vi.mocked(isGitHubAuthenticated).mockResolvedValue({
        authenticated: true,
        method: 'gh-cli',
      });

      const result = await connector.validateCredentials();
      expect(result).toBe(true);
    });

    it('should return false when not authenticated', async () => {
      const { isGitHubAuthenticated } = await import('../../git/github.js');
      vi.mocked(isGitHubAuthenticated).mockResolvedValue({
        authenticated: false,
        method: 'none',
      });

      const result = await connector.validateCredentials();
      expect(result).toBe(false);
    });
  });
});

describe('register', () => {
  afterEach(() => {
    registry.reset();
  });

  it('should register the GitHub auth connector', () => {
    register();

    const connector = registry.getAuth('github');
    expect(connector).toBeInstanceOf(GitHubAuthConnector);
    expect(connector?.provider).toBe('github');
  });

  it('should lazily instantiate the connector', () => {
    register();

    const providers = registry.listAuthProviders();
    expect(providers).toContain('github');
  });
});
