// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../cluster/runtime.js', () => ({
  fetchClusterStatusFromUrl: vi.fn(),
  fetchLocalClusterStatus: vi.fn(),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    cluster: {
      enabled: false,
      peers: [],
    },
  })),
}));

vi.mock('../../utils/paths.js', () => ({
  findHiveRoot: vi.fn(() => '/tmp'),
  getHivePaths: vi.fn(() => ({ hiveDir: '/tmp/.hive' })),
}));

import { clusterCommand } from './cluster.js';

describe('cluster command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have cluster command with correct name', () => {
      expect(clusterCommand.name()).toBe('cluster');
    });

    it('should have description', () => {
      expect(clusterCommand.description()).toContain('cluster');
    });

    it('should have status subcommand', () => {
      const statusCmd = clusterCommand.commands.find(cmd => cmd.name() === 'status');
      expect(statusCmd).toBeDefined();
    });
  });

  describe('status subcommand', () => {
    it('should have --json option', () => {
      const statusCmd = clusterCommand.commands.find(cmd => cmd.name() === 'status');
      const jsonOpt = statusCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });
});
