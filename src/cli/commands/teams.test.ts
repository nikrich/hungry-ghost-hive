// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/agents.js', () => ({
  getAgentsByTeam: vi.fn(() => []),
}));

vi.mock('../../db/queries/stories.js', () => ({
  getStoriesByTeam: vi.fn(() => []),
  getStoryPointsByTeam: vi.fn(() => 0),
}));

vi.mock('../../db/queries/teams.js', () => ({
  deleteTeam: vi.fn(),
  getAllTeams: vi.fn(() => []),
  getTeamByName: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { teamsCommand } from './teams.js';

describe('teams command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have teams command with correct name', () => {
      expect(teamsCommand.name()).toBe('teams');
    });

    it('should have description', () => {
      expect(teamsCommand.description()).toBe('Manage teams');
    });

    it('should have list subcommand', () => {
      const listCmd = teamsCommand.commands.find(cmd => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
    });

    it('should have show subcommand', () => {
      const showCmd = teamsCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
    });

    it('should have remove subcommand', () => {
      const removeCmd = teamsCommand.commands.find(cmd => cmd.name() === 'remove');
      expect(removeCmd).toBeDefined();
    });
  });

  describe('list subcommand', () => {
    it('should have --json option', () => {
      const listCmd = teamsCommand.commands.find(cmd => cmd.name() === 'list');
      const jsonOpt = listCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('show subcommand', () => {
    it('should accept name argument', () => {
      const showCmd = teamsCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd?.usage()).toContain('name');
    });
  });

  describe('remove subcommand', () => {
    it('should accept name argument', () => {
      const removeCmd = teamsCommand.commands.find(cmd => cmd.name() === 'remove');
      expect(removeCmd?.usage()).toContain('name');
    });

    it('should have --force option', () => {
      const removeCmd = teamsCommand.commands.find(cmd => cmd.name() === 'remove');
      const forceOpt = removeCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });
  });
});
