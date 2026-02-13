// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  createPullRequest: vi.fn(() => ({ id: 'pr-1', branch_name: 'test-branch', story_id: 'TEST-1' })),
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

vi.mock('../../integrations/jira/comments.js', () => ({
  postJiraLifecycleComment: vi.fn(),
}));

vi.mock('../../integrations/jira/transitions.js', () => ({
  syncStatusToJira: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
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
