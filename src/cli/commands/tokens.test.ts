// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/token-usage.js', () => ({
  getTokensByAgent: vi.fn(() => []),
  getTokensByStory: vi.fn(() => []),
  getTotalTokens: vi.fn(() => ({
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    record_count: 0,
  })),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {}, provider: {} } })),
}));

import {
  getTokensByAgent,
  getTokensByStory,
  getTotalTokens,
} from '../../db/queries/token-usage.js';
import { tokensCommand } from './tokens.js';

describe('tokens command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have tokens command with correct name', () => {
      expect(tokensCommand.name()).toBe('tokens');
    });

    it('should have description', () => {
      expect(tokensCommand.description()).toBe('Show token usage overview');
    });

    it('should have agent subcommand', () => {
      const agentCmd = tokensCommand.commands.find(cmd => cmd.name() === 'agent');
      expect(agentCmd).toBeDefined();
      expect(agentCmd?.description()).toContain('agent');
    });

    it('should have story subcommand', () => {
      const storyCmd = tokensCommand.commands.find(cmd => cmd.name() === 'story');
      expect(storyCmd).toBeDefined();
      expect(storyCmd?.description()).toContain('story');
    });
  });

  describe('overview action', () => {
    it('should have --since option', () => {
      const sinceOpt = tokensCommand.options.find(o => o.long === '--since');
      expect(sinceOpt).toBeDefined();
    });

    it('should have --until option', () => {
      const untilOpt = tokensCommand.options.find(o => o.long === '--until');
      expect(untilOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const jsonOpt = tokensCommand.options.find(o => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });

    it('should call getTotalTokens', async () => {
      await tokensCommand.parseAsync(['node', 'tokens']);
      expect(getTotalTokens).toHaveBeenCalled();
    });

    it('should output JSON when --json flag is set', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(getTotalTokens).mockResolvedValueOnce({
        total_input_tokens: 100,
        total_output_tokens: 200,
        total_tokens: 300,
        record_count: 5,
      });

      await tokensCommand.parseAsync(['node', 'tokens', '--json']);

      const jsonCall = consoleSpy.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('"total_tokens"')
      );
      expect(jsonCall).toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  describe('agent subcommand', () => {
    it('should have --json option', () => {
      const agentCmd = tokensCommand.commands.find(cmd => cmd.name() === 'agent');
      const jsonOpt = agentCmd?.options.find(o => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });

    it('should call getTokensByAgent with agent-id', async () => {
      await tokensCommand.parseAsync(['node', 'tokens', 'agent', 'agent-123']);
      expect(getTokensByAgent).toHaveBeenCalledWith(expect.anything(), 'agent-123');
    });

    it('should call getTokensByAgent when --json flag is set', async () => {
      const mockRows = [
        {
          id: 1,
          agent_id: 'agent-123',
          story_id: 'STORY-001',
          requirement_id: null,
          input_tokens: 50,
          output_tokens: 100,
          total_tokens: 150,
          model: 'claude-3',
          session_id: null,
          recorded_at: '2024-01-01T00:00:00.000Z',
        },
      ];
      vi.mocked(getTokensByAgent).mockResolvedValueOnce(mockRows);

      await tokensCommand.parseAsync(['node', 'tokens', 'agent', 'agent-123', '--json']);

      expect(getTokensByAgent).toHaveBeenCalledWith(expect.anything(), 'agent-123');
    });

    it('should show message when no records found', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(getTokensByAgent).mockResolvedValueOnce([]);

      await tokensCommand.parseAsync(['node', 'tokens', 'agent', 'unknown']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No token usage records found for agent')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('story subcommand', () => {
    it('should have --json option', () => {
      const storyCmd = tokensCommand.commands.find(cmd => cmd.name() === 'story');
      const jsonOpt = storyCmd?.options.find(o => o.long === '--json');
      expect(jsonOpt).toBeDefined();
    });

    it('should call getTokensByStory with story-id', async () => {
      await tokensCommand.parseAsync(['node', 'tokens', 'story', 'STORY-001']);
      expect(getTokensByStory).toHaveBeenCalledWith(expect.anything(), 'STORY-001');
    });

    it('should call getTokensByStory when --json flag is set', async () => {
      const mockRows = [
        {
          id: 1,
          agent_id: 'agent-123',
          story_id: 'STORY-001',
          requirement_id: null,
          input_tokens: 50,
          output_tokens: 100,
          total_tokens: 150,
          model: 'claude-3',
          session_id: null,
          recorded_at: '2024-01-01T00:00:00.000Z',
        },
      ];
      vi.mocked(getTokensByStory).mockResolvedValueOnce(mockRows);

      await tokensCommand.parseAsync(['node', 'tokens', 'story', 'STORY-001', '--json']);

      expect(getTokensByStory).toHaveBeenCalledWith(expect.anything(), 'STORY-001');
    });

    it('should show message when no records found', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(getTokensByStory).mockResolvedValueOnce([]);

      await tokensCommand.parseAsync(['node', 'tokens', 'story', 'UNKNOWN']);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No token usage records found for story')
      );
      consoleSpy.mockRestore();
    });
  });
});
