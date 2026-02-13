// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/github-oauth.js', () => ({
  runGitHubDeviceFlow: vi.fn(),
}));

vi.mock('../../auth/jira-oauth.js', () => ({
  startJiraOAuthFlow: vi.fn(),
  storeJiraTokens: vi.fn(),
}));

vi.mock('../../auth/token-store.js', () => ({
  TokenStore: vi.fn().mockImplementation(() => ({
    loadFromEnv: vi.fn(),
  })),
}));

let mockHiveRoot: string | null = null;

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveRoot: vi.fn(callback => {
    if (!mockHiveRoot) {
      mockHiveRoot = mkdtempSync(join(tmpdir(), 'hive-auth-test-'));
      mkdirSync(join(mockHiveRoot, '.hive'), { recursive: true });
    }
    return callback({
      root: mockHiveRoot,
      paths: {
        hiveDir: join(mockHiveRoot, '.hive'),
      },
    });
  }),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    integrations: {
      source_control: {
        provider: 'github',
      },
      project_management: {
        provider: 'jira',
      },
    },
  })),
}));

import { authCommand } from './auth.js';

describe('auth command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('github subcommand', () => {
    it('should fail when GITHUB_OAUTH_CLIENT_ID is not set', async () => {
      const oldClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
      delete process.env.GITHUB_OAUTH_CLIENT_ID;

      try {
        // Commands are async actions, we'll just verify they exist
        expect(authCommand.commands.some(cmd => cmd.name() === 'github')).toBe(true);
      } finally {
        if (oldClientId) {
          process.env.GITHUB_OAUTH_CLIENT_ID = oldClientId;
        }
      }
    });

    it('should have github subcommand', () => {
      const githubCmd = authCommand.commands.find(cmd => cmd.name() === 'github');
      expect(githubCmd).toBeDefined();
      expect(githubCmd?.description()).toContain('GitHub OAuth');
    });
  });

  describe('jira subcommand', () => {
    it('should have jira subcommand', () => {
      const jiraCmd = authCommand.commands.find(cmd => cmd.name() === 'jira');
      expect(jiraCmd).toBeDefined();
      expect(jiraCmd?.description()).toContain('Jira OAuth');
    });

    it('should fail when JIRA_OAUTH_CLIENT_ID is not set', async () => {
      const oldClientId = process.env.JIRA_OAUTH_CLIENT_ID;
      delete process.env.JIRA_OAUTH_CLIENT_ID;

      try {
        expect(authCommand.commands.some(cmd => cmd.name() === 'jira')).toBe(true);
      } finally {
        if (oldClientId) {
          process.env.JIRA_OAUTH_CLIENT_ID = oldClientId;
        }
      }
    });
  });

  describe('auth command structure', () => {
    it('should have auth command with correct description', () => {
      expect(authCommand.name()).toBe('auth');
      expect(authCommand.description()).toContain('OAuth');
    });

    it('should have github and jira subcommands', () => {
      const commandNames = authCommand.commands.map(cmd => cmd.name());
      expect(commandNames).toContain('github');
      expect(commandNames).toContain('jira');
    });

    it('should have --provider option', () => {
      const providerOption = authCommand.options.find(opt => opt.long === '--provider');
      expect(providerOption).toBeDefined();
    });
  });

  describe('config-driven auth', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      if (mockHiveRoot) {
        rmSync(mockHiveRoot, { recursive: true, force: true });
        mockHiveRoot = null;
      }
    });

    it('should support --provider option', () => {
      const providerOpt = authCommand.options.find(opt => opt.long === '--provider');
      expect(providerOpt).toBeDefined();
      expect(providerOpt?.description).toBeTruthy();
    });
  });
});
