// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/client.js', () => ({
  queryAll: vi.fn(() => []),
  queryOne: vi.fn(() => ({ id: 'agent-1', team_id: 'team-1' })),
  run: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
}));

vi.mock('../../db/queries/stories.js', () => ({
  createStory: vi.fn(() => ({ id: 'TEST-1', title: 'Test Story' })),
  getStoryDependencies: vi.fn(() => []),
  updateStory: vi.fn(),
}));

vi.mock('../../integrations/jira/transitions.js', () => ({
  syncStatusToJira: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {}, save: vi.fn() }, root: '/tmp' })),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { myStoriesCommand } from './my-stories.js';

describe('my-stories command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have my-stories command with correct name', () => {
      expect(myStoriesCommand.name()).toBe('my-stories');
    });

    it('should have description', () => {
      expect(myStoriesCommand.description()).toContain('stories');
    });

    it('should have --all option', () => {
      const allOpt = myStoriesCommand.options.find(opt => opt.long === '--all');
      expect(allOpt).toBeDefined();
    });

    it('should have claim subcommand', () => {
      const claimCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'claim');
      expect(claimCmd).toBeDefined();
    });

    it('should have complete subcommand', () => {
      const completeCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'complete');
      expect(completeCmd).toBeDefined();
    });

    it('should have refactor subcommand', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      expect(refactorCmd).toBeDefined();
    });
  });

  describe('claim subcommand', () => {
    it('should have required --session option', () => {
      const claimCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'claim');
      const sessionOpt = claimCmd?.options.find(opt => opt.long === '--session');
      expect(sessionOpt).toBeDefined();
      expect(sessionOpt?.required).toBe(true);
    });
  });

  describe('refactor subcommand', () => {
    it('should have required --session option', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      const sessionOpt = refactorCmd?.options.find(opt => opt.long === '--session');
      expect(sessionOpt).toBeDefined();
      expect(sessionOpt?.required).toBe(true);
    });

    it('should have required --title option', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      const titleOpt = refactorCmd?.options.find(opt => opt.long === '--title');
      expect(titleOpt).toBeDefined();
      expect(titleOpt?.required).toBe(true);
    });

    it('should have required --description option', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      const descOpt = refactorCmd?.options.find(opt => opt.long === '--description');
      expect(descOpt).toBeDefined();
      expect(descOpt?.required).toBe(true);
    });

    it('should have --points option', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      const pointsOpt = refactorCmd?.options.find(opt => opt.long === '--points');
      expect(pointsOpt).toBeDefined();
    });

    it('should have --status option', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      const statusOpt = refactorCmd?.options.find(opt => opt.long === '--status');
      expect(statusOpt).toBeDefined();
    });

    it('should have --criteria option', () => {
      const refactorCmd = myStoriesCommand.commands.find(cmd => cmd.name() === 'refactor');
      const criteriaOpt = refactorCmd?.options.find(opt => opt.long === '--criteria');
      expect(criteriaOpt).toBeDefined();
    });
  });
});
