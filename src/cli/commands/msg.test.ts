// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/client.js', () => ({
  queryAll: vi.fn(() => []),
  queryOne: vi.fn(),
  run: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {}, save: vi.fn() } })),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { msgCommand } from './msg.js';

describe('msg command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have msg command with correct name', () => {
      expect(msgCommand.name()).toBe('msg');
    });

    it('should have description', () => {
      expect(msgCommand.description()).toBe('Inter-agent messaging');
    });

    it('should have send subcommand', () => {
      const sendCmd = msgCommand.commands.find(cmd => cmd.name() === 'send');
      expect(sendCmd).toBeDefined();
    });

    it('should have inbox subcommand', () => {
      const inboxCmd = msgCommand.commands.find(cmd => cmd.name() === 'inbox');
      expect(inboxCmd).toBeDefined();
    });

    it('should have read subcommand', () => {
      const readCmd = msgCommand.commands.find(cmd => cmd.name() === 'read');
      expect(readCmd).toBeDefined();
    });

    it('should have reply subcommand', () => {
      const replyCmd = msgCommand.commands.find(cmd => cmd.name() === 'reply');
      expect(replyCmd).toBeDefined();
    });

    it('should have outbox subcommand', () => {
      const outboxCmd = msgCommand.commands.find(cmd => cmd.name() === 'outbox');
      expect(outboxCmd).toBeDefined();
    });
  });

  describe('send subcommand', () => {
    it('should accept to-session and message arguments', () => {
      const sendCmd = msgCommand.commands.find(cmd => cmd.name() === 'send');
      expect(sendCmd?.usage()).toContain('to-session');
      expect(sendCmd?.usage()).toContain('message');
    });

    it('should have --subject option', () => {
      const sendCmd = msgCommand.commands.find(cmd => cmd.name() === 'send');
      const subjectOpt = sendCmd?.options.find(opt => opt.long === '--subject');
      expect(subjectOpt).toBeDefined();
    });

    it('should have --from option', () => {
      const sendCmd = msgCommand.commands.find(cmd => cmd.name() === 'send');
      const fromOpt = sendCmd?.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });
  });

  describe('inbox subcommand', () => {
    it('should have --all option', () => {
      const inboxCmd = msgCommand.commands.find(cmd => cmd.name() === 'inbox');
      const allOpt = inboxCmd?.options.find(opt => opt.long === '--all');
      expect(allOpt).toBeDefined();
    });
  });
});
