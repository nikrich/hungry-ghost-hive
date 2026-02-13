// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../config/loader.js', () => ({
  createDefaultConfig: vi.fn(),
  loadConfig: vi.fn(() => ({ integrations: {} })),
  saveConfig: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  createDatabase: vi.fn(() => ({
    runMigrations: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('../../utils/paths.js', () => ({
  getHivePaths: vi.fn(() => ({
    hiveDir: '/tmp/.hive',
    agentsDir: '/tmp/.hive/agents',
    logsDir: '/tmp/.hive/logs',
    reposDir: '/tmp/repos',
    dbPath: '/tmp/.hive/hive.db',
  })),
  isHiveWorkspace: vi.fn(() => false),
}));

vi.mock('../wizard/init-wizard.js', () => ({
  runInitWizard: vi.fn(() => ({ integrations: {} })),
}));

import { initCommand } from './init.js';

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have init command with correct name', () => {
      expect(initCommand.name()).toBe('init');
    });

    it('should have description', () => {
      expect(initCommand.description()).toContain('Initialize');
    });

    it('should have --force option', () => {
      const forceOpt = initCommand.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('should have --non-interactive option', () => {
      const nonInteractiveOpt = initCommand.options.find(opt => opt.long === '--non-interactive');
      expect(nonInteractiveOpt).toBeDefined();
    });

    it('should have --source-control option', () => {
      const scOpt = initCommand.options.find(opt => opt.long === '--source-control');
      expect(scOpt).toBeDefined();
    });

    it('should have --project-management option', () => {
      const pmOpt = initCommand.options.find(opt => opt.long === '--project-management');
      expect(pmOpt).toBeDefined();
    });

    it('should have --autonomy option', () => {
      const autonomyOpt = initCommand.options.find(opt => opt.long === '--autonomy');
      expect(autonomyOpt).toBeDefined();
    });

    it('should have --jira-project option', () => {
      const jiraOpt = initCommand.options.find(opt => opt.long === '--jira-project');
      expect(jiraOpt).toBeDefined();
    });
  });
});
