// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPullRequest,
  getPullRequestById,
  updatePullRequest,
} from '../../db/queries/pull-requests.js';
import { autoMergeApprovedPRs } from '../../utils/auto-merge.js';
import { execa } from 'execa';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock dependencies
vi.mock('../../cluster/runtime.js', () => ({
  fetchLocalClusterStatus: vi.fn(),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(() => ({
    cluster: { enabled: false },
    scaling: {},
    models: {},
    qa: {},
  })),
}));

vi.mock('../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
}));

vi.mock('../../db/queries/pull-requests.js', () => ({
  createPullRequest: vi.fn((_db, input) => ({
    id: 'pr-1',
    branch_name: input.branchName,
    story_id: input.storyId ?? null,
    team_id: input.teamId ?? null,
    github_pr_number: input.githubPrNumber ?? null,
    github_pr_url: input.githubPrUrl ?? null,
    submitted_by: input.submittedBy ?? null,
    reviewed_by: null,
    status: 'queued',
    review_notes: null,
    created_at: '2026-02-14T00:00:00.000Z',
    updated_at: '2026-02-14T00:00:00.000Z',
    reviewed_at: null,
  })),
  getMergeQueue: vi.fn(() => []),
  getNextInQueue: vi.fn(),
  getOpenPullRequestsByStory: vi.fn(() => []),
  getPullRequestById: vi.fn(),
  getQueuePosition: vi.fn(() => 1),
  updatePullRequest: vi.fn(),
}));

vi.mock('../../db/queries/stories.js', () => ({
  getStoryById: vi.fn(() => ({ id: 'TEST-1', team_id: 'team-1' })),
  updateStory: vi.fn(),
}));

vi.mock('../../db/queries/teams.js', () => ({
  getTeamById: vi.fn(),
}));

vi.mock('../../connectors/project-management/operations.js', () => ({
  postLifecycleComment: vi.fn(),
  syncStatusForStory: vi.fn(),
}));

vi.mock('../../orchestrator/scheduler.js', () => ({
  Scheduler: vi.fn().mockImplementation(() => ({
    checkMergeQueue: vi.fn(),
  })),
}));

vi.mock('../../tmux/manager.js', () => ({
  isTmuxSessionRunning: vi.fn(),
  sendToTmuxSession: vi.fn(),
}));

vi.mock('../../utils/auto-merge.js', () => ({
  autoMergeApprovedPRs: vi.fn(() => 0),
}));

vi.mock('../../utils/pr-sync.js', () => ({
  getExistingPRIdentifiers: vi.fn(() => ({
    existingBranches: new Set(),
    existingPrNumbers: new Set(),
  })),
  syncOpenGitHubPRs: vi.fn(() => ({ imported: [], synced: 0 })),
}));

vi.mock('../../utils/story-id.js', () => ({
  extractStoryIdFromBranch: vi.fn(),
  normalizeStoryId: vi.fn(id => id),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ db: { db: {}, save: vi.fn() }, root: '/tmp', paths: { hiveDir: '/tmp/.hive' } })
  ),
  withReadOnlyHiveContext: vi.fn(callback => callback({ db: { db: {} } })),
}));

import { prCommand } from './pr.js';

describe('pr command', () => {
  const execaResult = (stdout = '', stderr = ''): Awaited<ReturnType<typeof execa>> =>
    ({ stdout, stderr } as Awaited<ReturnType<typeof execa>>);

  const resetCommandOptions = (command: Command): void => {
    for (const option of command.options) {
      command.setOptionValue(option.attributeName(), undefined);
    }
    for (const child of command.commands) {
      resetCommandOptions(child);
    }
  };

  const run = async (...args: string[]): Promise<void> => {
    await prCommand.parseAsync(args, { from: 'user' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(prCommand);

    vi.mocked(getPullRequestById).mockReturnValue({
      id: 'pr-1',
      story_id: 'TEST-1',
      team_id: 'team-1',
      branch_name: 'feature/test',
      github_pr_number: null,
      github_pr_url: 'https://github.com/test/repo/pull/1',
      submitted_by: 'hive-intermediate-test',
      reviewed_by: 'hive-qa-test',
      status: 'reviewing',
      review_notes: null,
      created_at: '2026-02-14T00:00:00.000Z',
      updated_at: '2026-02-14T00:00:00.000Z',
      reviewed_at: null,
    });
  });

  describe('command structure', () => {
    it('should have pr command with correct name', () => {
      expect(prCommand.name()).toBe('pr');
    });

    it('should have description', () => {
      expect(prCommand.description()).toContain('pull request');
    });

    it('should have submit subcommand', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      expect(submitCmd).toBeDefined();
    });

    it('should have queue subcommand', () => {
      const queueCmd = prCommand.commands.find(cmd => cmd.name() === 'queue');
      expect(queueCmd).toBeDefined();
    });

    it('should have review subcommand', () => {
      const reviewCmd = prCommand.commands.find(cmd => cmd.name() === 'review');
      expect(reviewCmd).toBeDefined();
    });

    it('should have show subcommand', () => {
      const showCmd = prCommand.commands.find(cmd => cmd.name() === 'show');
      expect(showCmd).toBeDefined();
    });

    it('should have approve subcommand', () => {
      const approveCmd = prCommand.commands.find(cmd => cmd.name() === 'approve');
      expect(approveCmd).toBeDefined();
    });

    it('should have reject subcommand', () => {
      const rejectCmd = prCommand.commands.find(cmd => cmd.name() === 'reject');
      expect(rejectCmd).toBeDefined();
    });

    it('should have sync subcommand', () => {
      const syncCmd = prCommand.commands.find(cmd => cmd.name() === 'sync');
      expect(syncCmd).toBeDefined();
    });
  });

  describe('submit subcommand', () => {
    it('should have required --branch option', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      const branchOpt = submitCmd?.options.find(opt => opt.long === '--branch');
      expect(branchOpt).toBeDefined();
      expect(branchOpt?.required).toBe(true);
    });

    it('should have required --story option', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      const storyOpt = submitCmd?.options.find(opt => opt.long === '--story');
      expect(storyOpt).toBeDefined();
      expect(storyOpt?.required).toBe(true);
    });

    it('should have --team option', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      const teamOpt = submitCmd?.options.find(opt => opt.long === '--team');
      expect(teamOpt).toBeDefined();
    });

    it('should have --pr-number option', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      const prNumberOpt = submitCmd?.options.find(opt => opt.long === '--pr-number');
      expect(prNumberOpt).toBeDefined();
    });

    it('should have --pr-url option', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      const prUrlOpt = submitCmd?.options.find(opt => opt.long === '--pr-url');
      expect(prUrlOpt).toBeDefined();
    });

    it('should have --from option', () => {
      const submitCmd = prCommand.commands.find(cmd => cmd.name() === 'submit');
      const fromOpt = submitCmd?.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });

    it('auto-creates a GitHub PR when submit has no --pr-url/--pr-number', async () => {
      vi.mocked(execa)
        .mockResolvedValueOnce(execaResult('origin/main'))
        .mockResolvedValueOnce(execaResult('https://github.com/test/repo/pull/123'));

      await run('submit', '--branch', 'feature/test', '--story', 'TEST-1');

      expect(createPullRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          branchName: 'feature/test',
          githubPrNumber: 123,
          githubPrUrl: 'https://github.com/test/repo/pull/123',
        })
      );
      expect(execa).toHaveBeenNthCalledWith(
        2,
        'gh',
        ['pr', 'create', '--head', 'feature/test', '--fill', '--base', 'main'],
        expect.objectContaining({ cwd: '/tmp' })
      );
    });

    it('links existing GitHub PR when create reports already exists', async () => {
      const alreadyExistsError = Object.assign(
        new Error('a pull request for branch "feature/test" already exists'),
        { stderr: 'a pull request for branch "feature/test" already exists' }
      );

      vi.mocked(execa)
        .mockResolvedValueOnce(execaResult('origin/main'))
        .mockRejectedValueOnce(alreadyExistsError)
        .mockResolvedValueOnce(
          execaResult(JSON.stringify({ number: 456, url: 'https://github.com/test/repo/pull/456' }))
        );

      await run('submit', '--branch', 'feature/test', '--story', 'TEST-1');

      expect(createPullRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          branchName: 'feature/test',
          githubPrNumber: 456,
          githubPrUrl: 'https://github.com/test/repo/pull/456',
        })
      );
      expect(execa).toHaveBeenNthCalledWith(
        3,
        'gh',
        ['pr', 'view', 'feature/test', '--json', 'number,url'],
        expect.objectContaining({ cwd: '/tmp' })
      );
    });

    it('aborts submit when GitHub PR cannot be created or found', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(execa)
        .mockResolvedValueOnce(execaResult('origin/main'))
        .mockRejectedValueOnce(new Error('gh auth failed'))
        .mockRejectedValueOnce(new Error('no PR found'));

      await expect(run('submit', '--branch', 'feature/test', '--story', 'TEST-1')).rejects.toThrow(
        'process.exit'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(createPullRequest).not.toHaveBeenCalled();

      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('queue subcommand', () => {
    it('should have --team option', () => {
      const queueCmd = prCommand.commands.find(cmd => cmd.name() === 'queue');
      const teamOpt = queueCmd?.options.find(opt => opt.long === '--team');
      expect(teamOpt).toBeDefined();
    });

    it('should have --json option', () => {
      const queueCmd = prCommand.commands.find(cmd => cmd.name() === 'queue');
      const jsonOpt = queueCmd?.options.find(opt => opt.long === '--json');
      expect(jsonOpt).toBeDefined();
    });
  });

  describe('approve subcommand', () => {
    it('should have --notes option', () => {
      const approveCmd = prCommand.commands.find(cmd => cmd.name() === 'approve');
      const notesOpt = approveCmd?.options.find(opt => opt.long === '--notes');
      expect(notesOpt).toBeDefined();
    });

    it('should have --from option', () => {
      const approveCmd = prCommand.commands.find(cmd => cmd.name() === 'approve');
      const fromOpt = approveCmd?.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });

    it('should have --no-merge option', () => {
      const approveCmd = prCommand.commands.find(cmd => cmd.name() === 'approve');
      const noMergeOpt = approveCmd?.options.find(opt => opt.long === '--no-merge');
      expect(noMergeOpt).toBeDefined();
    });

    it('should not trigger immediate auto-merge when --no-merge is provided', async () => {
      await run('approve', 'pr-1', '--no-merge');

      expect(updatePullRequest).toHaveBeenCalledWith(
        expect.anything(),
        'pr-1',
        expect.objectContaining({
          status: 'approved',
          reviewNotes: '[manual-merge-required]',
        })
      );
      expect(autoMergeApprovedPRs).not.toHaveBeenCalled();
    });

    it('should trigger immediate auto-merge for approved PRs when merge is enabled', async () => {
      await run('approve', 'pr-1');

      expect(updatePullRequest).toHaveBeenCalledWith(
        expect.anything(),
        'pr-1',
        expect.objectContaining({
          status: 'approved',
        })
      );
      expect(autoMergeApprovedPRs).toHaveBeenCalledTimes(1);
    });
  });

  describe('reject subcommand', () => {
    it('should have required --reason option', () => {
      const rejectCmd = prCommand.commands.find(cmd => cmd.name() === 'reject');
      const reasonOpt = rejectCmd?.options.find(opt => opt.long === '--reason');
      expect(reasonOpt).toBeDefined();
      expect(reasonOpt?.required).toBe(true);
    });

    it('should have --from option', () => {
      const rejectCmd = prCommand.commands.find(cmd => cmd.name() === 'reject');
      const fromOpt = rejectCmd?.options.find(opt => opt.long === '--from');
      expect(fromOpt).toBeDefined();
    });
  });

  describe('sync subcommand', () => {
    it('should have --repo option', () => {
      const syncCmd = prCommand.commands.find(cmd => cmd.name() === 'sync');
      const repoOpt = syncCmd?.options.find(opt => opt.long === '--repo');
      expect(repoOpt).toBeDefined();
    });
  });
});
