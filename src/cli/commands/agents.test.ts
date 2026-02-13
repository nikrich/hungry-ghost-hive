// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/agents.js', () => ({
  deleteAgent: vi.fn(),
  getActiveAgents: vi.fn(() => []),
  getAgentById: vi.fn(),
  getAgentsByStatus: vi.fn(() => []),
  getAllAgents: vi.fn(() => []),
}));

vi.mock('../../db/queries/logs.js', () => ({
  getLogsByAgent: vi.fn(() => []),
}));

vi.mock('../../git/worktree.js', () => ({
  removeWorktree: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {} }, root: '/tmp' })),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { agentsCommand } from './agents.js';

describe('agents command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have agents command with correct name', () => {
      expect(agentsCommand.name()).toBe('agents');
    });

    it('should have description', () => {
      expect(agentsCommand.description()).toBe('Manage agents');
    });

    it('should have list subcommand', () => {
      const listCmd = agentsCommand.commands.find(cmd => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
    });

    it('should have logs subcommand', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      expect(logsCmd).toBeDefined();
    });
  });

  describe('list subcommand', () => {
    it('should have --active option', () => {
      const listCmd = agentsCommand.commands.find(cmd => cmd.name() === 'list');
      const activeOpt = listCmd?.options.find(opt => opt.long === '--active');
      expect(activeOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const listCmd = agentsCommand.commands.find(cmd => cmd.name() === 'list');
      const jsonOpt = listCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('logs subcommand', () => {
    it('should accept agent-id argument', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      expect(logsCmd?.usage()).toContain('agent-id');
    });

    it('should have --limit option', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      const limitOpt = logsCmd?.options.find(opt => opt.long === '--limit');
      expect(limitOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      const jsonOpt = logsCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });
});
