// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../cli-runtimes/index.js', () => ({
  getCliRuntimeBuilder: vi.fn(() => ({
    buildSpawnCommand: vi.fn(() => [
      'claude',
      '--dangerously-skip-permissions',
      '--model',
      'sonnet',
    ]),
  })),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    models: {
      senior: {
        model: 'claude-sonnet-4-20250514',
        cli_tool: 'claude',
        safety_mode: 'unsafe',
      },
    },
  })),
}));

vi.mock('../../db/queries/agents.js', () => ({
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(() => []),
  createAgent: vi.fn(() => ({ id: 'senior-test123', type: 'senior', team_id: 'team-1' })),
  updateAgent: vi.fn(),
}));

vi.mock('../../db/queries/requirements.js', () => ({
  getPendingRequirements: vi.fn(() => []),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(() => [{ id: 'team-1', name: 'test-team', repo_path: 'repos/test-repo' }]),
}));

vi.mock('../../tmux/manager.js', () => ({
  sendMessageWithConfirmation: vi.fn(() => true),
  isTmuxSessionRunning: vi.fn(() => true),
  spawnTmuxSession: vi.fn(),
}));

vi.mock('../../utils/instance.js', () => ({
  getTechLeadSessionName: vi.fn(() => 'hive-test-tech-lead'),
  buildInstanceSessionName: vi.fn(() => 'hive-test-chat-test-team'),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({
      db: {
        provider: {
          run: vi.fn(),
          queryOne: vi.fn(),
          queryAll: vi.fn(() => []),
        },
        save: vi.fn(),
      },
      paths: { hiveDir: '/tmp/.hive' },
      root: '/tmp/workspace',
    })
  ),
}));

import { messageCommand } from './message.js';

describe('message command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have message command with correct name', () => {
      expect(messageCommand.name()).toBe('message');
    });

    it('should have description', () => {
      expect(messageCommand.description()).toBe('Send messages directly to agent tmux sessions');
    });

    it('should have --agent option', () => {
      const agentOpt = messageCommand.options.find(opt => opt.long === '--agent');
      expect(agentOpt).toBeDefined();
    });

    it('should have --new option', () => {
      const newOpt = messageCommand.options.find(opt => opt.long === '--new');
      expect(newOpt).toBeDefined();
    });

    it('should have --from option', () => {
      const fromOpt = messageCommand.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });

    it('should accept optional text argument', () => {
      const args = messageCommand.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('text');
      expect(args[0].required).toBe(false);
    });
  });
});
