// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/agents.js', () => ({
  getAgentById: vi.fn(),
  getAllAgents: vi.fn(() => []),
}));

vi.mock('../../tmux/manager.js', () => ({
  sendMessageWithConfirmation: vi.fn(() => true),
  isTmuxSessionRunning: vi.fn(() => true),
}));

vi.mock('../../utils/instance.js', () => ({
  getTechLeadSessionName: vi.fn(() => 'hive-test-tech-lead'),
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

    it('should have --agent required option', () => {
      const agentOpt = messageCommand.options.find(opt => opt.long === '--agent');
      expect(agentOpt).toBeDefined();
      expect(agentOpt?.required).toBe(true);
    });

    it('should have --from option', () => {
      const fromOpt = messageCommand.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });

    it('should accept text argument', () => {
      const args = messageCommand.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('text');
    });
  });
});
