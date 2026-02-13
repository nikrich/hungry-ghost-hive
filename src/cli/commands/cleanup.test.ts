// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/agents.js', () => ({
  getAllAgents: vi.fn(() => []),
}));

vi.mock('../../db/queries/stories.js', () => ({
  getStoriesWithOrphanedAssignments: vi.fn(() => []),
  updateStoryAssignment: vi.fn(),
}));

vi.mock('../../tmux/manager.js', () => ({
  getHiveSessions: vi.fn(() => []),
  isTmuxSessionRunning: vi.fn(() => false),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ db: { db: {}, save: vi.fn() }, root: '/tmp', paths: { hiveDir: '/tmp/.hive' } })
  ),
}));

import { cleanupCommand } from './cleanup.js';

describe('cleanup command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have cleanup command with correct name', () => {
      expect(cleanupCommand.name()).toBe('cleanup');
    });

    it('should have description', () => {
      expect(cleanupCommand.description()).toContain('Clean');
    });

    it('should have --dry-run option', () => {
      const dryRunOpt = cleanupCommand.options.find(opt => opt.long === '--dry-run');
      expect(dryRunOpt).toBeDefined();
    });

    it('should have --force option', () => {
      const forceOpt = cleanupCommand.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });
  });
});
