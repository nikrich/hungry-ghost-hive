// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({
      db: { db: {}, provider: { run: vi.fn() }, save: vi.fn() },
      paths: { hiveDir: '/tmp/test-hive' },
    })
  ),
}));

vi.mock('../../utils/instance.js', () => ({
  getTechLeadSessionName: vi.fn(() => 'tech-lead-session'),
}));

import { btwCommand } from './btw.js';

describe('btw command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have correct name', () => {
      expect(btwCommand.name()).toBe('btw');
    });

    it('should have a description', () => {
      expect(btwCommand.description()).toBeTruthy();
    });

    it('should accept to-session and message arguments', () => {
      const usage = btwCommand.usage();
      expect(usage).toContain('to-session');
      expect(usage).toContain('message');
    });

    it('should have --from option', () => {
      const fromOpt = btwCommand.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });
  });
});
