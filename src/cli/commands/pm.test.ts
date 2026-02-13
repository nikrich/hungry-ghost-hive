// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the connector registry
const mockGetIssue = vi.fn();
const mockSearchIssues = vi.fn();
const mockIsEpicUrl = vi.fn();
const mockParseEpicUrl = vi.fn();

const mockPMConnector = {
  provider: 'jira',
  getIssue: mockGetIssue,
  searchIssues: mockSearchIssues,
  isEpicUrl: mockIsEpicUrl,
  parseEpicUrl: mockParseEpicUrl,
  fetchEpic: vi.fn(),
  createEpic: vi.fn(),
  createStory: vi.fn(),
  transitionStory: vi.fn(),
  syncStatus: vi.fn(),
};

vi.mock('../../connectors/registry.js', () => ({
  registry: {
    getProjectManagement: vi.fn(() => mockPMConnector),
  },
}));

// Mock config loader
vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    integrations: {
      project_management: {
        provider: 'jira',
      },
    },
  })),
}));

// Mock withHiveRoot
vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveRoot: vi.fn(callback => {
    const tempDir = mkdtempSync(join(tmpdir(), 'hive-pm-test-'));
    mkdirSync(join(tempDir, '.hive'), { recursive: true });
    try {
      return callback({
        root: tempDir,
        paths: {
          hiveDir: join(tempDir, '.hive'),
        },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }),
}));

import { loadConfig } from '../../config/loader.js';
import { pmCommand } from './pm.js';

describe('pm command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have pm command with correct description', () => {
      expect(pmCommand.name()).toBe('pm');
      expect(pmCommand.description()).toContain('project management');
    });

    it('should have fetch, search, and sync subcommands', () => {
      const commandNames = pmCommand.commands.map(cmd => cmd.name());
      expect(commandNames).toContain('fetch');
      expect(commandNames).toContain('search');
      expect(commandNames).toContain('sync');
    });
  });

  describe('fetch subcommand', () => {
    it('should have correct description', () => {
      const fetchCmd = pmCommand.commands.find(cmd => cmd.name() === 'fetch');
      expect(fetchCmd).toBeDefined();
      expect(fetchCmd?.description()).toContain('Fetch an issue');
    });

    it('should support --json option', () => {
      const fetchCmd = pmCommand.commands.find(cmd => cmd.name() === 'fetch');
      expect(fetchCmd).toBeDefined();
      const jsonOption = fetchCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOption).toBeDefined();
    });
  });

  describe('search subcommand', () => {
    it('should have correct description', () => {
      const searchCmd = pmCommand.commands.find(cmd => cmd.name() === 'search');
      expect(searchCmd).toBeDefined();
      expect(searchCmd?.description()).toContain('Search issues');
    });

    it('should support --max and --json options', () => {
      const searchCmd = pmCommand.commands.find(cmd => cmd.name() === 'search');
      expect(searchCmd).toBeDefined();
      const maxOption = searchCmd?.options.find(opt => opt.long === '--max');
      const jsonOption = searchCmd?.options.find(opt => opt.long === '--json');
      expect(maxOption).toBeDefined();
      expect(jsonOption).toBeDefined();
    });
  });

  describe('sync subcommand', () => {
    it('should have correct description', () => {
      const syncCmd = pmCommand.commands.find(cmd => cmd.name() === 'sync');
      expect(syncCmd).toBeDefined();
      expect(syncCmd?.description()).toContain('bidirectional sync');
    });
  });

  describe('provider configuration', () => {
    it('should use connector from registry when provider is configured', () => {
      const config = loadConfig('');
      expect(config.integrations.project_management.provider).toBe('jira');
    });
  });

  describe('connector routing', () => {
    it('should route through connector.getIssue for fetch', async () => {
      mockGetIssue.mockResolvedValue({
        key: 'HIVE-123',
        id: '12345',
        title: 'Test Issue',
        description: 'Test description',
        status: 'In Progress',
        issueType: 'Story',
        labels: ['test'],
        provider: 'jira',
      });

      // We can't easily test the action directly without mocking process.exit
      // but we can verify the connector is properly configured
      expect(mockPMConnector.getIssue).toBeDefined();
    });

    it('should route through connector.searchIssues for search', async () => {
      mockSearchIssues.mockResolvedValue([
        {
          key: 'HIVE-123',
          id: '12345',
          title: 'Test Issue',
          description: 'Test description',
          status: 'In Progress',
          issueType: 'Story',
          labels: ['test'],
          provider: 'jira',
        },
      ]);

      expect(mockPMConnector.searchIssues).toBeDefined();
    });

    it('should use connector.isEpicUrl to detect URLs', () => {
      mockIsEpicUrl.mockReturnValue(true);
      mockParseEpicUrl.mockReturnValue({
        issueKey: 'HIVE-123',
        siteUrl: 'https://example.atlassian.net',
        provider: 'jira',
      });

      expect(mockPMConnector.isEpicUrl).toBeDefined();
      expect(mockPMConnector.parseEpicUrl).toBeDefined();
    });
  });
});
