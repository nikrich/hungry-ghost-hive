// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/client.js', () => ({
  queryOne: vi.fn(() => ({ count: 0 })),
  run: vi.fn(),
}));

vi.mock('../../tmux/manager.js', () => ({
  killAllHiveSessions: vi.fn(() => 0),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {}, save: vi.fn() } })),
}));

import { nukeCommand } from './nuke.js';

describe('nuke command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have nuke command with correct name', () => {
      expect(nukeCommand.name()).toBe('nuke');
    });

    it('should have description', () => {
      expect(nukeCommand.description()).toContain('Delete');
    });

    it('should have stories subcommand', () => {
      const storiesCmd = nukeCommand.commands.find(cmd => cmd.name() === 'stories');
      expect(storiesCmd).toBeDefined();
    });

    it('should have agents subcommand', () => {
      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      expect(agentsCmd).toBeDefined();
    });

    it('should have requirements subcommand', () => {
      const reqCmd = nukeCommand.commands.find(cmd => cmd.name() === 'requirements');
      expect(reqCmd).toBeDefined();
    });

    it('should have all subcommand', () => {
      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      expect(allCmd).toBeDefined();
    });
  });

  describe('subcommands have --force option', () => {
    it('stories subcommand should have --force option', () => {
      const storiesCmd = nukeCommand.commands.find(cmd => cmd.name() === 'stories');
      const forceOpt = storiesCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('agents subcommand should have --force option', () => {
      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      const forceOpt = agentsCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('requirements subcommand should have --force option', () => {
      const reqCmd = nukeCommand.commands.find(cmd => cmd.name() === 'requirements');
      const forceOpt = reqCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('all subcommand should have --force option', () => {
      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      const forceOpt = allCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });
  });
});
