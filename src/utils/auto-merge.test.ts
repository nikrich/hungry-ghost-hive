// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgent, getAgentById, updateAgent } from '../db/queries/agents.js';
import {
  createPullRequest,
  getApprovedPullRequests,
  updatePullRequest,
} from '../db/queries/pull-requests.js';
import { createStory, getStoryById, updateStory } from '../db/queries/stories.js';
import { createTeam } from '../db/queries/teams.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';

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
});
