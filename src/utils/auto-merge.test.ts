// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { loadConfig } from '../config/loader.js';
import { autoMergeApprovedPRs } from './auto-merge.js';

const mockLoadConfig = vi.mocked(loadConfig);

describe('auto-merge functionality', () => {
  let db: Database;
  let teamId: string;
  let storyId: string;

  beforeEach(async () => {
    db = await createTestDatabase();

    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;

    const story = createStory(db, {
      title: 'Test Story',
      description: 'Test description',
      teamId,
    });
    storyId = story.id;
  });

  describe('getApprovedPullRequests', () => {
    it('should return empty list when no approved PRs exist', () => {
      const approved = getApprovedPullRequests(db);
      expect(approved).toHaveLength(0);
    });

    it('should return only approved PRs, not queued or reviewing', () => {
      const pr1 = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-1',
        githubPrNumber: 111,
        githubPrUrl: 'https://github.com/test/repo/pull/111',
      });

      const pr2 = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-2',
        githubPrNumber: 222,
        githubPrUrl: 'https://github.com/test/repo/pull/222',
      });

      updatePullRequest(db, pr1.id, { status: 'approved' });
      updatePullRequest(db, pr2.id, { status: 'reviewing' });

      const approved = getApprovedPullRequests(db);

      expect(approved).toHaveLength(1);
      expect(approved[0].id).toBe(pr1.id);
      expect(approved[0].status).toBe('approved');
    });

    it('should return approved PRs in creation order (oldest first)', () => {
      const pr1 = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-1',
        githubPrNumber: 111,
      });

      const pr2 = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-2',
        githubPrNumber: 222,
      });

      updatePullRequest(db, pr1.id, { status: 'approved' });
      updatePullRequest(db, pr2.id, { status: 'approved' });

      const approved = getApprovedPullRequests(db);

      expect(approved).toHaveLength(2);
      expect(approved[0].id).toBe(pr1.id);
      expect(approved[1].id).toBe(pr2.id);
    });

    it('should require github_pr_number for merging to be possible', () => {
      const prWithNumber = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/with-number',
        githubPrNumber: 333,
      });

      const prWithoutNumber = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/without-number',
      });

      updatePullRequest(db, prWithNumber.id, { status: 'approved' });
      updatePullRequest(db, prWithoutNumber.id, { status: 'approved' });

      const approved = getApprovedPullRequests(db);

      expect(approved).toHaveLength(2);
      expect(approved.filter(p => p.github_pr_number)).toHaveLength(1);
    });
  });

  describe('agent cleanup on story merge', () => {
    it('should allow agent currentStoryId to be cleared when story is merged', () => {
      // Create an agent assigned to the story
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
        model: 'claude-sonnet-4-20250514',
      });
      updateAgent(db, agent.id, { status: 'working', currentStoryId: storyId });

      // Assign story to agent
      updateStory(db, storyId, { assignedAgentId: agent.id, status: 'in_progress' });

      // Simulate what auto-merge now does: clear agent's currentStoryId
      const story = getStoryById(db, storyId);
      expect(story?.assigned_agent_id).toBe(agent.id);

      const agentBefore = getAgentById(db, agent.id);
      expect(agentBefore?.current_story_id).toBe(storyId);
      expect(agentBefore?.status).toBe('working');

      // Clear the agent's currentStoryId (as auto-merge now does)
      updateAgent(db, agent.id, { currentStoryId: null, status: 'idle' });

      const agentAfter = getAgentById(db, agent.id);
      expect(agentAfter?.current_story_id).toBeNull();
      expect(agentAfter?.status).toBe('idle');
    });

    it('should not clear agent currentStoryId if agent moved to different story', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
        model: 'claude-sonnet-4-20250514',
      });

      // Create a second story
      const story2 = createStory(db, {
        title: 'Second Story',
        description: 'Another story',
        teamId,
      });

      // Agent is now working on story2, not the original storyId
      updateAgent(db, agent.id, { status: 'working', currentStoryId: story2.id });

      // When the original story merges, agent's currentStoryId is story2 (different)
      // so we should NOT clear it
      const agentCheck = getAgentById(db, agent.id);
      expect(agentCheck?.current_story_id).toBe(story2.id);
      expect(agentCheck?.current_story_id).not.toBe(storyId);

      // The guard condition: only clear if agent.current_story_id === storyId
      if (agentCheck?.current_story_id === storyId) {
        updateAgent(db, agent.id, { currentStoryId: null, status: 'idle' });
      }

      // Agent should still have story2 as current story
      const agentAfter = getAgentById(db, agent.id);
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
      const pr = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test',
        githubPrNumber: 123,
      });
      updatePullRequest(db, pr.id, { status: 'approved' });

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
        db,
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
        db,
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

    it('should skip approved PRs marked for manual merge', async () => {
      const pr = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/manual-merge',
        githubPrNumber: 999,
      });
      updatePullRequest(db, pr.id, {
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
        db,
        save: vi.fn(),
        close: vi.fn(),
        runMigrations: vi.fn(),
      };

      const result = await autoMergeApprovedPRs('/mock/root', dbClient);
      expect(result).toBe(0);
      expect(getPullRequestById(db, pr.id)?.status).toBe('approved');
    });
  });
});
