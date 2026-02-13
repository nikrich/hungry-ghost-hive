// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../auth/env-store.js', () => ({
  loadEnvIntoProcess: vi.fn(),
}));

vi.mock('../../auth/token-store.js', () => ({
  TokenStore: vi.fn().mockImplementation(() => ({
    loadFromEnv: vi.fn(),
  })),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    integrations: {
      project_management: {
        provider: 'jira',
        jira: {},
      },
    },
  })),
}));

vi.mock('../../db/client.js', () => ({
  queryOne: vi.fn(() => ({ id: 'TEST-1', external_subtask_key: 'JIRA-123' })),
}));

vi.mock('../../integrations/jira/client.js', () => ({
  JiraClient: vi.fn(),
}));

vi.mock('../../integrations/jira/comments.js', () => ({
  postProgressToSubtask: vi.fn(),
  transitionSubtask: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ db: { db: {} }, paths: { hiveDir: '/tmp/.hive' } })
  ),
}));

import { progressCommand } from './progress.js';

describe('progress command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have progress command with correct name', () => {
      expect(progressCommand.name()).toBe('progress');
    });

    it('should have description', () => {
      expect(progressCommand.description()).toContain('progress');
    });

    it('should accept story-id argument', () => {
      // The command usage should contain story-id
      expect(progressCommand.usage()).toContain('story-id');
    });

    it('should have required --message option', () => {
      const messageOpt = progressCommand.options.find(opt => opt.long === '--message');
      expect(messageOpt).toBeDefined();
      expect(messageOpt?.required).toBe(true);
    });

    it('should have --from option', () => {
      const fromOpt = progressCommand.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });

    it('should have --done option', () => {
      const doneOpt = progressCommand.options.find(opt => opt.long === '--done');
      expect(doneOpt).toBeDefined();
    });
  });
});
