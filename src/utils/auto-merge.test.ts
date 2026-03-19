// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProvider } from '../db/provider.js';
import { createAgent, getAgentById, updateAgent } from '../db/queries/agents.js';
import {
  createPullRequest,
  getApprovedPullRequests,
  getPullRequestById,
  updatePullRequest,
} from '../db/queries/pull-requests.js';
import { createStory, getStoryById, updateStory } from '../db/queries/stories.js';
import { createTeam } from '../db/queries/teams.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';

vi.mock('../config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('./paths.js', () => ({
  getHivePaths: vi.fn(() => ({ hiveDir: '/mock/hive' })),
}));

vi.mock('../connectors/project-management/operations.js', () => ({
  postLifecycleComment: vi.fn().mockResolvedValue(undefined),
  syncStatusForStory: vi.fn(),
}));

import { loadConfig } from '../config/loader.js';
import { autoMergeApprovedPRs, checkPreexistingCIFailures } from './auto-merge.js';

const mockLoadConfig = vi.mocked(loadConfig);

describe('auto-merge functionality', () => {
  let db: SqliteProvider;
  let teamId: string;
  let storyId: string;

  beforeEach(async () => {
    const rawDb = await createTestDatabase();
    db = new SqliteProvider(rawDb);

    const team = await createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;

    const story = await createStory(db, {
      title: 'Test Story',
      description: 'Test description',
      teamId,
    });
    storyId = story.id;
  });

  describe('getApprovedPullRequests', () => {
    it('should return empty list when no approved PRs exist', async () => {
      const approved = await getApprovedPullRequests(db);
      expect(approved).toHaveLength(0);
    });

    it('should return only approved PRs, not queued or reviewing', async () => {
      const pr1 = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-1',
        githubPrNumber: 111,
        githubPrUrl: 'https://github.com/test/repo/pull/111',
      });

      const pr2 = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-2',
        githubPrNumber: 222,
        githubPrUrl: 'https://github.com/test/repo/pull/222',
      });

      await updatePullRequest(db, pr1.id, { status: 'approved' });
      await updatePullRequest(db, pr2.id, { status: 'reviewing' });

      const approved = await getApprovedPullRequests(db);

      expect(approved).toHaveLength(1);
      expect(approved[0].id).toBe(pr1.id);
      expect(approved[0].status).toBe('approved');
    });

    it('should return approved PRs in creation order (oldest first)', async () => {
      const pr1 = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-1',
        githubPrNumber: 111,
      });

      const pr2 = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-2',
        githubPrNumber: 222,
      });

      await updatePullRequest(db, pr1.id, { status: 'approved' });
      await updatePullRequest(db, pr2.id, { status: 'approved' });

      const approved = await getApprovedPullRequests(db);

      expect(approved).toHaveLength(2);
      expect(approved[0].id).toBe(pr1.id);
      expect(approved[1].id).toBe(pr2.id);
    });

    it('should require github_pr_number for merging to be possible', async () => {
      const prWithNumber = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/with-number',
        githubPrNumber: 333,
      });

      const prWithoutNumber = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/without-number',
      });

      await updatePullRequest(db, prWithNumber.id, { status: 'approved' });
      await updatePullRequest(db, prWithoutNumber.id, { status: 'approved' });

      const approved = await getApprovedPullRequests(db);

      expect(approved).toHaveLength(2);
      expect(approved.filter(p => p.github_pr_number)).toHaveLength(1);
    });
  });

  describe('agent cleanup on story merge', () => {
    it('should allow agent currentStoryId to be cleared when story is merged', async () => {
      // Create an agent assigned to the story
      const agent = await createAgent(db, {
        type: 'senior',
        teamId,
        model: 'claude-sonnet-4-20250514',
      });
      await updateAgent(db, agent.id, { status: 'working', currentStoryId: storyId });

      // Assign story to agent
      await updateStory(db, storyId, { assignedAgentId: agent.id, status: 'in_progress' });

      // Simulate what auto-merge now does: clear agent's currentStoryId
      const story = await getStoryById(db, storyId);
      expect(story?.assigned_agent_id).toBe(agent.id);

      const agentBefore = await getAgentById(db, agent.id);
      expect(agentBefore?.current_story_id).toBe(storyId);
      expect(agentBefore?.status).toBe('working');

      // Clear the agent's currentStoryId (as auto-merge now does)
      await updateAgent(db, agent.id, { currentStoryId: null, status: 'idle' });

      const agentAfter = await getAgentById(db, agent.id);
      expect(agentAfter?.current_story_id).toBeNull();
      expect(agentAfter?.status).toBe('idle');
    });

    it('should not clear agent currentStoryId if agent moved to different story', async () => {
      const agent = await createAgent(db, {
        type: 'senior',
        teamId,
        model: 'claude-sonnet-4-20250514',
      });

      // Create a second story
      const story2 = await createStory(db, {
        title: 'Second Story',
        description: 'Another story',
        teamId,
      });

      // Agent is now working on story2, not the original storyId
      await updateAgent(db, agent.id, { status: 'working', currentStoryId: story2.id });

      // When the original story merges, agent's currentStoryId is story2 (different)
      // so we should NOT clear it
      const agentCheck = await getAgentById(db, agent.id);
      expect(agentCheck?.current_story_id).toBe(story2.id);
      expect(agentCheck?.current_story_id).not.toBe(storyId);

      // The guard condition: only clear if agent.current_story_id === storyId
      if (agentCheck?.current_story_id === storyId) {
        await updateAgent(db, agent.id, { currentStoryId: null, status: 'idle' });
      }

      // Agent should still have story2 as current story
      const agentAfter = await getAgentById(db, agent.id);
      expect(agentAfter?.current_story_id).toBe(story2.id);
      expect(agentAfter?.status).toBe('working');
    });
  });

  describe('autonomy level enforcement', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should skip auto-merge when autonomy level is partial', async () => {
      // Setup: Create an approved PR
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test',
        githubPrNumber: 123,
      });
      await updatePullRequest(db, pr.id, { status: 'approved' });

      // Mock config with partial autonomy
      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: {
            level: 'partial',
          },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      // Create a minimal database client wrapper
      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };

      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      // Should return 0 (no PRs merged) in partial mode
      expect(result).toBe(0);
      // loadConfig should have been called
      expect(mockLoadConfig).toHaveBeenCalledWith('/mock/hive');
    });

    it('should not skip auto-merge when autonomy level is full', async () => {
      // Mock config with full autonomy
      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: {
            level: 'full',
          },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      // Create a minimal database client wrapper (no approved PRs)
      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };

      // With full autonomy and no approved PRs, should return 0 (not skip due to autonomy)
      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      // Should return 0 because there are no approved PRs, not because of autonomy level
      expect(result).toBe(0);
      // loadConfig should have been called
      expect(mockLoadConfig).toHaveBeenCalledWith('/mock/hive');
    });

    it('should keep PR as queued when auto-merge is pending (PR still open after gh pr merge --auto)', async () => {
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/auto-merge-pending',
        githubPrNumber: 456,
      });
      await updatePullRequest(db, pr.id, { status: 'approved' });

      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: { level: 'full' },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      // Mock execSync: first call returns OPEN+MERGEABLE, merge command succeeds,
      // second call (post-merge check) returns OPEN (auto-merge pending)
      const mockExecSync = vi.fn();
      mockExecSync
        .mockReturnValueOnce(
          JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' })
        )
        .mockReturnValueOnce(undefined) // gh pr merge --auto
        .mockReturnValueOnce(
          JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' })
        );

      vi.doMock('child_process', () => ({ execSync: mockExecSync }));

      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };
      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      // Should return 0 because the PR was not actually merged yet
      expect(result).toBe(0);
      // PR should remain 'queued' (not rolled back to 'approved' or advanced to 'merged')
      expect((await getPullRequestById(db, pr.id))?.status).toBe('queued');
    });

    it('should reset stale branch PR to approved after updating behind branch', async () => {
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/stale-branch',
        githubPrNumber: 789,
      });
      await updatePullRequest(db, pr.id, { status: 'approved' });

      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: { level: 'full' },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      // Mock execSync: PR state shows BEHIND, then gh pr update-branch succeeds
      const mockExecSync = vi.fn();
      mockExecSync
        .mockReturnValueOnce(
          JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' })
        )
        .mockReturnValueOnce(undefined); // gh pr update-branch

      vi.doMock('child_process', () => ({ execSync: mockExecSync }));

      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };
      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      // Should return 0 because no merge happened yet
      expect(result).toBe(0);
      // PR should be reset to 'approved' to be retried on next cycle
      expect((await getPullRequestById(db, pr.id))?.status).toBe('approved');
    });

    it('should skip approved PRs marked for manual merge', async () => {
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/manual-merge',
        githubPrNumber: 999,
      });
      await updatePullRequest(db, pr.id, {
        status: 'approved',
        reviewNotes: '[manual-merge-required]',
      });

      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: {
            level: 'full',
          },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };

      const result = await autoMergeApprovedPRs('/mock/root', dbClient);
      expect(result).toBe(0);
      expect((await getPullRequestById(db, pr.id))?.status).toBe('approved');
    });

    it('should bypass BLOCKED status when all CI failures are pre-existing on base branch', async () => {
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/preexisting-ci',
        githubPrNumber: 555,
      });
      await updatePullRequest(db, pr.id, { status: 'approved' });

      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: { level: 'full', allow_preexisting_ci_failures: true },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      const mockExecSync = vi.fn();
      // 1. gh pr view → BLOCKED but MERGEABLE
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' })
      );
      // 2. gh pr checks → one failing check
      mockExecSync.mockReturnValueOnce(
        JSON.stringify([
          { name: 'build', state: 'SUCCESS' },
          { name: 'lint', state: 'FAIL' },
        ])
      );
      // 3. gh pr view baseRefName
      mockExecSync.mockReturnValueOnce(JSON.stringify({ baseRefName: 'main' }));
      // 4. gh api base branch check-runs → same check failing
      mockExecSync.mockReturnValueOnce(
        JSON.stringify([
          { name: 'build', conclusion: 'success' },
          { name: 'lint', conclusion: 'failure' },
        ])
      );
      // 5. gh pr merge --admin → success
      mockExecSync.mockReturnValueOnce(undefined);

      vi.doMock('child_process', () => ({ execSync: mockExecSync }));

      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };
      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      expect(result).toBe(1);
      expect((await getPullRequestById(db, pr.id))?.status).toBe('merged');
    });

    it('should not bypass BLOCKED status when PR has new CI failures not on base branch', async () => {
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/new-ci-failure',
        githubPrNumber: 556,
      });
      await updatePullRequest(db, pr.id, { status: 'approved' });

      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: { level: 'full', allow_preexisting_ci_failures: true },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      const mockExecSync = vi.fn();
      // 1. gh pr view → BLOCKED but MERGEABLE
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' })
      );
      // 2. gh pr checks → two failing checks
      mockExecSync.mockReturnValueOnce(
        JSON.stringify([
          { name: 'build', state: 'FAIL' },
          { name: 'lint', state: 'FAIL' },
        ])
      );
      // 3. gh pr view baseRefName
      mockExecSync.mockReturnValueOnce(JSON.stringify({ baseRefName: 'main' }));
      // 4. gh api base branch check-runs → only lint fails on base
      mockExecSync.mockReturnValueOnce(
        JSON.stringify([
          { name: 'build', conclusion: 'success' },
          { name: 'lint', conclusion: 'failure' },
        ])
      );

      vi.doMock('child_process', () => ({ execSync: mockExecSync }));

      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };
      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      // Should not merge — 'build' is a new failure
      expect(result).toBe(0);
      // PR should be reset to approved (ci_blocked outcome)
      expect((await getPullRequestById(db, pr.id))?.status).toBe('approved');
    });

    it('should skip BLOCKED PR when allow_preexisting_ci_failures is false', async () => {
      const pr = await createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/ci-blocked-no-bypass',
        githubPrNumber: 557,
      });
      await updatePullRequest(db, pr.id, { status: 'approved' });

      mockLoadConfig.mockReturnValue({
        integrations: {
          autonomy: { level: 'full', allow_preexisting_ci_failures: false },
          source_control: { provider: 'github' },
          project_management: { provider: 'none' },
        },
      } as any);

      const mockExecSync = vi.fn();
      // gh pr view → BLOCKED but MERGEABLE
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' })
      );

      vi.doMock('child_process', () => ({ execSync: mockExecSync }));

      const dbClient = {
        db: db.db,
        provider: db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };
      const result = await autoMergeApprovedPRs('/mock/root', dbClient);

      expect(result).toBe(0);
      expect((await getPullRequestById(db, pr.id))?.status).toBe('approved');
    });
  });

  describe('checkPreexistingCIFailures', () => {
    it('should return bypassed=true when all PR failures exist on base branch', () => {
      const mockExecSync = vi.fn();
      // gh pr checks
      mockExecSync.mockReturnValueOnce(
        JSON.stringify([
          { name: 'build', state: 'SUCCESS' },
          { name: 'lint', state: 'FAIL' },
          { name: 'test', state: 'FAIL' },
        ])
      );
      // gh pr view baseRefName
      mockExecSync.mockReturnValueOnce(JSON.stringify({ baseRefName: 'main' }));
      // gh api check-runs
      mockExecSync.mockReturnValueOnce(
        JSON.stringify([
          { name: 'build', conclusion: 'success' },
          { name: 'lint', conclusion: 'failure' },
          { name: 'test', conclusion: 'failure' },
        ])
      );

      const result = checkPreexistingCIFailures(
        123,
        '/repo',
        '',
        'owner/repo',
        mockExecSync as any
      );
      expect(result.bypassed).toBe(true);
      expect(result.bypassedChecks).toEqual(expect.arrayContaining(['lint', 'test']));
    });

    it('should return bypassed=false when PR has unique failures', () => {
      const mockExecSync = vi.fn();
      mockExecSync.mockReturnValueOnce(JSON.stringify([{ name: 'build', state: 'FAIL' }]));
      mockExecSync.mockReturnValueOnce(JSON.stringify({ baseRefName: 'main' }));
      mockExecSync.mockReturnValueOnce(JSON.stringify([{ name: 'build', conclusion: 'success' }]));

      const result = checkPreexistingCIFailures(
        123,
        '/repo',
        '',
        'owner/repo',
        mockExecSync as any
      );
      expect(result.bypassed).toBe(false);
    });

    it('should return bypassed=false when no PR checks are failing', () => {
      const mockExecSync = vi.fn();
      mockExecSync.mockReturnValueOnce(JSON.stringify([{ name: 'build', state: 'SUCCESS' }]));

      const result = checkPreexistingCIFailures(
        123,
        '/repo',
        '',
        'owner/repo',
        mockExecSync as any
      );
      expect(result.bypassed).toBe(false);
      expect(result.bypassedChecks).toEqual([]);
    });

    it('should return bypassed=false when execSync throws', () => {
      const mockExecSync = vi.fn().mockImplementation(() => {
        throw new Error('gh not found');
      });

      const result = checkPreexistingCIFailures(
        123,
        '/repo',
        '',
        'owner/repo',
        mockExecSync as any
      );
      expect(result.bypassed).toBe(false);
    });
  });
});
