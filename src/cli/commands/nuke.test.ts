// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/client.js', () => ({
  queryOne: vi.fn(() => ({ count: 0 })),
  queryAll: vi.fn(() => []),
  run: vi.fn(),
}));

vi.mock('../../tmux/manager.js', () => ({
  killAllHiveSessions: vi.fn(() => 0),
}));

vi.mock('../../git/worktree.js', () => ({
  removeWorktree: vi.fn(() => ({ success: true, fullWorktreePath: '/root/repos/agent-1' })),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ db: { db: {}, save: vi.fn() }, root: '/root', paths: {} })
  ),
}));

import { queryAll, run } from '../../db/client.js';
import { removeWorktree } from '../../git/worktree.js';
import { killAllHiveSessions } from '../../tmux/manager.js';
import { nukeCommand } from './nuke.js';

describe('nuke command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have nuke command with correct name', () => {
      expect(nukeCommand.name()).toBe('nuke');
    });

    it('should have description', () => {
      expect(nukeCommand.description()).toContain('Delete');
    });

    it('should have stories subcommand', () => {
      const storiesCmd = nukeCommand.commands.find(cmd => cmd.name() === 'stories');
      expect(storiesCmd).toBeDefined();
    });

    it('should have agents subcommand', () => {
      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      expect(agentsCmd).toBeDefined();
    });

    it('should have requirements subcommand', () => {
      const reqCmd = nukeCommand.commands.find(cmd => cmd.name() === 'requirements');
      expect(reqCmd).toBeDefined();
    });

    it('should have all subcommand', () => {
      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      expect(allCmd).toBeDefined();
    });
  });

  describe('subcommands have --force option', () => {
    it('stories subcommand should have --force option', () => {
      const storiesCmd = nukeCommand.commands.find(cmd => cmd.name() === 'stories');
      const forceOpt = storiesCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('agents subcommand should have --force option', () => {
      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      const forceOpt = agentsCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('requirements subcommand should have --force option', () => {
      const reqCmd = nukeCommand.commands.find(cmd => cmd.name() === 'requirements');
      const forceOpt = reqCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });

    it('all subcommand should have --force option', () => {
      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      const forceOpt = allCmd?.options.find(opt => opt.long === '--force');
      expect(forceOpt).toBeDefined();
    });
  });

  describe('nuke agents worktree cleanup', () => {
    it('should remove agent worktrees before deleting agents from DB', async () => {
      vi.mocked(queryAll).mockReturnValue([
        { worktree_path: 'repos/team-agent-abc123' },
        { worktree_path: 'repos/team-agent-def456' },
      ]);

      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      await agentsCmd?.parseAsync(['--force'], { from: 'user' });

      expect(removeWorktree).toHaveBeenCalledTimes(2);
      expect(removeWorktree).toHaveBeenCalledWith('/root', 'repos/team-agent-abc123');
      expect(removeWorktree).toHaveBeenCalledWith('/root', 'repos/team-agent-def456');
    });

    it('should remove worktrees before DB deletions (worktree query runs first)', async () => {
      const callOrder: string[] = [];
      vi.mocked(queryAll).mockImplementation(() => {
        callOrder.push('queryAll');
        return [];
      });
      vi.mocked(run).mockImplementation(() => {
        callOrder.push('run');
      });

      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      await agentsCmd?.parseAsync(['--force'], { from: 'user' });

      const queryAllIndex = callOrder.indexOf('queryAll');
      const firstRunIndex = callOrder.indexOf('run');
      expect(queryAllIndex).toBeLessThan(firstRunIndex);
    });

    it('should skip worktree removal when agent has no worktree_path', async () => {
      vi.mocked(queryAll).mockReturnValue([{ worktree_path: null }]);

      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      await agentsCmd?.parseAsync(['--force'], { from: 'user' });

      expect(removeWorktree).not.toHaveBeenCalled();
    });

    it('should delete messages table when nuking agents', async () => {
      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      await agentsCmd?.parseAsync(['--force'], { from: 'user' });

      const runCalls = vi.mocked(run).mock.calls.map(c => c[1] as string);
      expect(runCalls).toContain('DELETE FROM messages');
    });

    it('should kill tmux sessions when nuking agents', async () => {
      const agentsCmd = nukeCommand.commands.find(cmd => cmd.name() === 'agents');
      await agentsCmd?.parseAsync(['--force'], { from: 'user' });

      expect(killAllHiveSessions).toHaveBeenCalled();
    });
  });

  describe('nuke all worktree and table cleanup', () => {
    it('should remove agent worktrees when nuking all', async () => {
      vi.mocked(queryAll).mockReturnValue([{ worktree_path: 'repos/team-agent-xyz789' }]);

      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      await allCmd?.parseAsync(['--force'], { from: 'user' });

      expect(removeWorktree).toHaveBeenCalledWith('/root', 'repos/team-agent-xyz789');
    });

    it('should delete messages table when nuking all', async () => {
      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      await allCmd?.parseAsync(['--force'], { from: 'user' });

      const runCalls = vi.mocked(run).mock.calls.map(c => c[1] as string);
      expect(runCalls).toContain('DELETE FROM messages');
    });

    it('should delete integration_sync table when nuking all', async () => {
      const allCmd = nukeCommand.commands.find(cmd => cmd.name() === 'all');
      await allCmd?.parseAsync(['--force'], { from: 'user' });

      const runCalls = vi.mocked(run).mock.calls.map(c => c[1] as string);
      expect(runCalls).toContain('DELETE FROM integration_sync');
    });
  });

  describe('nuke stories integration_sync cleanup', () => {
    it('should delete story and pull_request integration_sync entries when nuking stories', async () => {
      // Return story count > 0 so the action proceeds
      vi.mocked(queryAll).mockReturnValue([]);
      const { queryOne } = await import('../../db/client.js');
      vi.mocked(queryOne).mockReturnValue({ count: 3 });

      const storiesCmd = nukeCommand.commands.find(cmd => cmd.name() === 'stories');
      await storiesCmd?.parseAsync(['--force'], { from: 'user' });

      const runCalls = vi.mocked(run).mock.calls.map(c => c[1] as string);
      expect(runCalls).toContain(
        "DELETE FROM integration_sync WHERE entity_type IN ('story', 'pull_request')"
      );
    });
  });

  describe('nuke requirements integration_sync cleanup', () => {
    it('should delete all integration_sync entries when nuking requirements', async () => {
      const { queryOne } = await import('../../db/client.js');
      vi.mocked(queryOne).mockReturnValue({ count: 2 });

      const reqCmd = nukeCommand.commands.find(cmd => cmd.name() === 'requirements');
      await reqCmd?.parseAsync(['--force'], { from: 'user' });

      const runCalls = vi.mocked(run).mock.calls.map(c => c[1] as string);
      expect(runCalls).toContain('DELETE FROM integration_sync');
    });
  });
});
