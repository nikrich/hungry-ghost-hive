// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../auth/token-store.js', () => ({
  TokenStore: vi.fn().mockImplementation(() => ({
    loadFromEnv: vi.fn(),
  })),
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    integrations: {
      project_management: {
        provider: 'jira',
        jira: {},
      },
    },
  })),
}));

vi.mock('../../db/queries/stories.js', () => ({
  createStory: vi.fn(),
  getAllStories: vi.fn(() => []),
  getStoriesByStatus: vi.fn(() => []),
  getStoryById: vi.fn(),
  getStoryDependencies: vi.fn(() => []),
  updateStory: vi.fn(),
}));

vi.mock('../../integrations/jira/stories.js', () => ({
  syncStoryToJira: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {} }, paths: { hiveDir: '/tmp' } })),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { storiesCommand } from './stories.js';

describe('stories command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have stories command with correct name', () => {
      expect(storiesCommand.name()).toBe('stories');
    });

    it('should have description', () => {
      expect(storiesCommand.description()).toBe('Manage stories');
    });

    it('should have list subcommand', () => {
      const listCmd = storiesCommand.commands.find(cmd => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
      expect(listCmd?.description()).toContain('List');
    });

    it('should have create subcommand', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      expect(createCmd).toBeDefined();
      expect(createCmd?.description()).toContain('Create');
    });

    it('should have show subcommand', () => {
      const showCmd = storiesCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
      expect(showCmd?.description()).toContain('Show');
    });
  });

  describe('list subcommand', () => {
    it('should have --status option', () => {
      const listCmd = storiesCommand.commands.find(cmd => cmd.name() === 'list');
      const statusOpt = listCmd?.options.find(opt => opt.long === '--status');
      expect(statusOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const listCmd = storiesCommand.commands.find(cmd => cmd.name() === 'list');
      const jsonOpt = listCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('create subcommand', () => {
    it('should have required --title option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const titleOpt = createCmd?.options.find(opt => opt.long === '--title');
      expect(titleOpt).toBeDefined();
      expect(titleOpt?.required).toBe(true);
    });

    it('should have required --description option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const descOpt = createCmd?.options.find(opt => opt.long === '--description');
      expect(descOpt).toBeDefined();
      expect(descOpt?.required).toBe(true);
    });

    it('should have --requirement option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const reqOpt = createCmd?.options.find(opt => opt.long === '--requirement');
      expect(reqOpt).toBeDefined();
    });

    it('should have --team option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const teamOpt = createCmd?.options.find(opt => opt.long === '--team');
      expect(teamOpt).toBeDefined();
    });

    it('should have --points option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const pointsOpt = createCmd?.options.find(opt => opt.long === '--points');
      expect(pointsOpt).toBeDefined();
    });

    it('should have --complexity option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const complexityOpt = createCmd?.options.find(opt => opt.long === '--complexity');
      expect(complexityOpt).toBeDefined();
    });

    it('should have --criteria option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const criteriaOpt = createCmd?.options.find(opt => opt.long === '--criteria');
      expect(criteriaOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const createCmd = storiesCommand.commands.find(cmd => cmd.name() === 'create');
      const jsonOpt = createCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('show subcommand', () => {
    it('should accept story-id argument', () => {
      const showCmd = storiesCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
      // The command has an argument <story-id>
      expect(showCmd?.usage()).toContain('story-id');
    });
  });
});
