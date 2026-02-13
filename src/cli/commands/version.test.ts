// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../utils/version.js', () => ({
  getVersion: vi.fn(() => '1.0.0'),
}));

import { versionCommand } from './version.js';

describe('version command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have version command with correct name', () => {
      expect(versionCommand.name()).toBe('version');
    });

    it('should have description', () => {
      expect(versionCommand.description()).toContain('version');
    });
  });
});
