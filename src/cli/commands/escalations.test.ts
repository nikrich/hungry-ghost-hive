// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/escalations.js', () => ({
  acknowledgeEscalation: vi.fn(),
  getAllEscalations: vi.fn(() => []),
  getEscalationById: vi.fn(),
  getPendingEscalations: vi.fn(() => []),
  resolveEscalation: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { escalationsCommand } from './escalations.js';

describe('escalations command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have escalations command with correct name', () => {
      expect(escalationsCommand.name()).toBe('escalations');
    });

    it('should have description', () => {
      expect(escalationsCommand.description()).toBe('Manage escalations');
    });

    it('should have list subcommand', () => {
      const listCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
    });

    it('should have show subcommand', () => {
      const showCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
    });

    it('should have resolve subcommand', () => {
      const resolveCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'resolve');
      expect(resolveCmd).toBeDefined();
    });

    it('should have acknowledge subcommand', () => {
      const ackCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'acknowledge');
      expect(ackCmd).toBeDefined();
    });
  });

  describe('list subcommand', () => {
    it('should have --all option', () => {
      const listCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'list');
      const allOpt = listCmd?.options.find(opt => opt.long === '--all');
      expect(allOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const listCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'list');
      const jsonOpt = listCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('resolve subcommand', () => {
    it('should have required --message option', () => {
      const resolveCmd = escalationsCommand.commands.find(cmd => cmd.name() === 'resolve');
      const messageOpt = resolveCmd?.options.find(opt => opt.long === '--message');
      expect(messageOpt).toBeDefined();
      expect(messageOpt?.required).toBe(true);
    });
  });
});
