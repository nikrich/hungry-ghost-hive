// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../config/loader.js', () => ({
  ConfigError: class ConfigError extends Error {},
  getConfigValue: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  saveConfig: vi.fn(),
  setConfigValue: vi.fn((config, path, value) => ({ ...config, [path]: value })),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveRoot: vi.fn(callback => callback({ paths: { hiveDir: '/tmp/.hive' } })),
}));

import { configCommand } from './config.js';

describe('config command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have config command with correct name', () => {
      expect(configCommand.name()).toBe('config');
    });

    it('should have description', () => {
      expect(configCommand.description()).toContain('configuration');
    });

    it('should have show subcommand', () => {
      const showCmd = configCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
    });

    it('should have get subcommand', () => {
      const getCmd = configCommand.commands.find(cmd => cmd.name() === 'get');
      expect(getCmd).toBeDefined();
    });

    it('should have set subcommand', () => {
      const setCmd = configCommand.commands.find(cmd => cmd.name() === 'set');
      expect(setCmd).toBeDefined();
    });
  });

  describe('show subcommand', () => {
    it('should have --json option', () => {
      const showCmd = configCommand.commands.find(cmd => cmd.name() === 'show');
      const jsonOpt = showCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('get subcommand', () => {
    it('should accept path argument', () => {
      const getCmd = configCommand.commands.find(cmd => cmd.name() === 'get');
      expect(getCmd?.usage()).toContain('path');
    });
  });

  describe('set subcommand', () => {
    it('should accept path and value arguments', () => {
      const setCmd = configCommand.commands.find(cmd => cmd.name() === 'set');
      expect(setCmd?.usage()).toContain('path');
      expect(setCmd?.usage()).toContain('value');
    });
  });
});
