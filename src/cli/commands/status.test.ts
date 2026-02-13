// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock database queries
vi.mock('../../db/queries/agents.js', () => ({
  getActiveAgents: vi.fn(),
  getAllAgents: vi.fn(),
}));

vi.mock('../../db/queries/escalations.js', () => ({
  getPendingEscalations: vi.fn(),
  getPendingHumanEscalations: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  getLogsByStory: vi.fn(),
  getRecentLogs: vi.fn(),
}));

vi.mock('../../db/queries/requirements.js', () => ({
  getPendingRequirements: vi.fn(),
  getRequirementById: vi.fn(),
}));

vi.mock('../../db/queries/stories.js', () => ({
  getStoriesByTeam: vi.fn(),
  getStoryById: vi.fn(),
  getStoryCounts: vi.fn(),
  getStoryDependencies: vi.fn(),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(),
  getTeamByName: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { statusCommand } from './status.js';

describe('status command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have status command with correct name', () => {
      expect(statusCommand.name()).toBe('status');
    });

    it('should have description', () => {
      expect(statusCommand.description()).toBe('Show Hive status');
    });

    it('should have --team option', () => {
      const teamOption = statusCommand.options.find(opt => opt.long === '--team');
      expect(teamOption).toBeDefined();
      expect(teamOption?.description).toContain('team');
    });

    it('should have --story option', () => {
      const storyOption = statusCommand.options.find(opt => opt.long === '--story');
      expect(storyOption).toBeDefined();
      expect(storyOption?.description).toContain('story');
    });

    it('should have --json option', () => {
      const jsonOption = statusCommand.options.find(opt => opt.long === '--json');
      expect(jsonOption).toBeDefined();
      expect(jsonOption?.description).toContain('JSON');
    });
  });

  describe('command options', () => {
    it('should accept team parameter', () => {
      const teamOpt = statusCommand.options.find(opt => opt.long === '--team');
      expect(teamOpt?.long).toBe('--team');
    });

    it('should accept story parameter', () => {
      const storyOpt = statusCommand.options.find(opt => opt.long === '--story');
      expect(storyOpt?.long).toBe('--story');
    });

    it('should accept json flag', () => {
      const jsonOpt = statusCommand.options.find(opt => opt.long === '--json');
      expect(jsonOpt?.long).toBe('--json');
    });
  });
});
