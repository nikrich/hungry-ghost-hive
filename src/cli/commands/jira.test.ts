// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pm command
vi.mock('./pm.js', () => ({
  pmCommand: {
    commands: [],
  },
}));

import { jiraCommand } from './jira.js';

describe('jira command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have jira command with correct name', () => {
      expect(jiraCommand.name()).toBe('jira');
    });

    it('should have description mentioning deprecation', () => {
      expect(jiraCommand.description()).toContain('deprecated');
    });
  });
});
