// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process before importing module
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock dependencies
vi.mock('../../db/queries/agents.js', () => ({
  deleteAgent: vi.fn(),
  getActiveAgents: vi.fn(() => []),
  getAgentById: vi.fn(),
  getAgentByTmuxSession: vi.fn(),
  getAgentsByStatus: vi.fn(() => []),
  getAllAgents: vi.fn(() => []),
  updateAgent: vi.fn(),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
  getLogsByAgent: vi.fn(() => []),
}));

vi.mock('../../git/worktree.js', () => ({
  removeWorktree: vi.fn(() => ({ success: true, fullWorktreePath: '/tmp/worktree' })),
}));

const mockSave = vi.fn();
vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ db: { db: {}, save: mockSave }, root: '/tmp/hive' })
  ),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { getAgentByTmuxSession, updateAgent } from '../../db/queries/agents.js';
import { createLog } from '../../db/queries/logs.js';
import { removeWorktree } from '../../git/worktree.js';
import { agentsCommand, selfTerminate } from './agents.js';

describe('agents command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have agents command with correct name', () => {
      expect(agentsCommand.name()).toBe('agents');
    });

    it('should have description', () => {
      expect(agentsCommand.description()).toBe('Manage agents');
    });

    it('should have list subcommand', () => {
      const listCmd = agentsCommand.commands.find(cmd => cmd.name() === 'list');
      expect(listCmd).toBeDefined();
    });

    it('should have logs subcommand', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      expect(logsCmd).toBeDefined();
    });
  });

  describe('list subcommand', () => {
    it('should have --active option', () => {
      const listCmd = agentsCommand.commands.find(cmd => cmd.name() === 'list');
      const activeOpt = listCmd?.options.find(opt => opt.long === '--active');
      expect(activeOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const listCmd = agentsCommand.commands.find(cmd => cmd.name() === 'list');
      const jsonOpt = listCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('logs subcommand', () => {
    it('should accept agent-id argument', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      expect(logsCmd?.usage()).toContain('agent-id');
    });

    it('should have --limit option', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      const limitOpt = logsCmd?.options.find(opt => opt.long === '--limit');
      expect(limitOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const logsCmd = agentsCommand.commands.find(cmd => cmd.name() === 'logs');
      const jsonOpt = logsCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('self-terminate subcommand', () => {
    it('should have self-terminate subcommand', () => {
      const cmd = agentsCommand.commands.find(cmd => cmd.name() === 'self-terminate');
      expect(cmd).toBeDefined();
    });

    it('should have --session option', () => {
      const cmd = agentsCommand.commands.find(cmd => cmd.name() === 'self-terminate');
      const sessionOpt = cmd?.options.find(opt => opt.long === '--session');
      expect(sessionOpt).toBeDefined();
    });

    it('should have description', () => {
      const cmd = agentsCommand.commands.find(cmd => cmd.name() === 'self-terminate');
      expect(cmd?.description()).toBe('Cleanly self-terminate the current agent');
    });
  });

  describe('selfTerminate', () => {
    const mockAgent = {
      id: 'auditor-abc123',
      type: 'auditor' as const,
      team_id: 'team-1',
      tmux_session: 'hive-auditor-123',
      model: 'opus',
      status: 'working' as const,
      current_story_id: null,
      memory_state: null,
      last_seen: null,
      cli_tool: 'claude',
      worktree_path: 'repos/auditor-abc123',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('should terminate agent and clean up worktree', async () => {
      vi.mocked(getAgentByTmuxSession).mockReturnValue(mockAgent);

      await selfTerminate('hive-auditor-123');

      expect(getAgentByTmuxSession).toHaveBeenCalledWith({}, 'hive-auditor-123');
      expect(removeWorktree).toHaveBeenCalledWith('/tmp/hive', 'repos/auditor-abc123');
      expect(updateAgent).toHaveBeenCalledWith({}, 'auditor-abc123', {
        status: 'terminated',
        currentStoryId: null,
      });
      expect(createLog).toHaveBeenCalledWith(
        {},
        {
          agentId: 'auditor-abc123',
          eventType: 'AGENT_TERMINATED',
          message: 'Agent self-terminated (session: hive-auditor-123)',
        }
      );
      expect(mockSave).toHaveBeenCalled();
    });

    it('should skip worktree cleanup when no worktree exists', async () => {
      vi.mocked(getAgentByTmuxSession).mockReturnValue({
        ...mockAgent,
        worktree_path: null,
      });

      await selfTerminate('hive-auditor-123');

      expect(removeWorktree).not.toHaveBeenCalled();
      expect(updateAgent).toHaveBeenCalledWith({}, 'auditor-abc123', {
        status: 'terminated',
        currentStoryId: null,
      });
      expect(createLog).toHaveBeenCalled();
    });

    it('should handle already terminated agent gracefully', async () => {
      vi.mocked(getAgentByTmuxSession).mockReturnValue({
        ...mockAgent,
        status: 'terminated' as const,
      });

      await selfTerminate('hive-auditor-123');

      expect(updateAgent).not.toHaveBeenCalled();
      expect(createLog).not.toHaveBeenCalled();
      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it('should exit with error when agent not found', async () => {
      vi.mocked(getAgentByTmuxSession).mockReturnValue(undefined);
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });

      await expect(selfTerminate('nonexistent-session')).rejects.toThrow('process.exit');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(updateAgent).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it('should continue when worktree removal fails', async () => {
      vi.mocked(getAgentByTmuxSession).mockReturnValue(mockAgent);
      vi.mocked(removeWorktree).mockReturnValue({
        success: false,
        error: 'worktree not found',
        fullWorktreePath: '/tmp/hive/repos/auditor-abc123',
      });

      await selfTerminate('hive-auditor-123');

      expect(updateAgent).toHaveBeenCalled();
      expect(createLog).toHaveBeenCalled();
    });
  });
});
