// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Command } from 'commander';
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

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
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
    callback({ root: '/tmp', db: { db: {} }, paths: { hiveDir: '/tmp/.hive' } })
  ),
}));

import { loadConfig } from '../../config/loader.js';
import { queryOne } from '../../db/client.js';
import { createLog } from '../../db/queries/logs.js';
import { progressCommand } from './progress.js';

describe('progress command', () => {
  const resetCommandOptions = (command: Command): void => {
    for (const option of command.options) {
      command.setOptionValue(option.attributeName(), undefined);
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(progressCommand);
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

  describe('provider-aware behavior', () => {
    it('should record progress locally when project management provider is none', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        integrations: {
          project_management: {
            provider: 'none',
          },
        },
      } as any);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await progressCommand.parseAsync(['STORY-123', '-m', 'Implemented fix'], { from: 'user' });

      expect(createLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          storyId: 'STORY-123',
          eventType: 'STORY_PROGRESS_UPDATE',
          message: 'Implemented fix',
        })
      );
      expect(queryOne).not.toHaveBeenCalled();
      expect(String(logSpy.mock.calls[0]?.[0] || '')).toContain(
        'No project management provider configured'
      );
    });
  });
});
