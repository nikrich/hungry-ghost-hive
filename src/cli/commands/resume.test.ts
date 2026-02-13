// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../cli-runtimes/index.js', () => ({
  getCliRuntimeBuilder: vi.fn(() => ({
    buildResumeCommand: vi.fn(() => ['claude', 'code']),
  })),
  resolveRuntimeModelForCli: vi.fn(model => model),
  selectCompatibleModelForCli: vi.fn((cli, model) => model),
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    models: {
      'senior-engineer': {
        cli_tool: 'claude_code',
        safety_mode: 'ask',
        model: 'claude-sonnet-4.5',
      },
    },
  })),
}));

vi.mock('../../db/client.js', () => ({
  withTransaction: vi.fn(async (db, fn) => fn()),
}));

vi.mock('../../db/queries/agents.js', () => ({
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(() => []),
  updateAgent: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getTeamById: vi.fn(),
}));

vi.mock('../../tmux/manager.js', () => ({
  isTmuxAvailable: vi.fn(() => true),
  isTmuxSessionRunning: vi.fn(() => false),
  spawnTmuxSession: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {} }, root: '/tmp', paths: { hiveDir: '/tmp/.hive' } })),
}));

import { resumeCommand } from './resume.js';

describe('resume command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have resume command with correct name', () => {
      expect(resumeCommand.name()).toBe('resume');
    });

    it('should have description', () => {
      expect(resumeCommand.description()).toContain('Resume');
    });

    it('should have --agent option', () => {
      const agentOpt = resumeCommand.options.find(opt => opt.long === '--agent');
      expect(agentOpt).toBeDefined();
    });

    it('should have --all option', () => {
      const allOpt = resumeCommand.options.find(opt => opt.long === '--all');
      expect(allOpt).toBeDefined();
    });
  });
});
