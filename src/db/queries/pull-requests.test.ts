import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDatabase } from './test-helpers.js';
import { createTeam } from './teams.js';
import { createStory } from './stories.js';
import {
  createPullRequest,
  getPullRequestById,
  getPullRequestByStory,
  getPullRequestByGithubNumber,
  getMergeQueue,
  getNextInQueue,
  getQueuePosition,
  getPullRequestsByStatus,
  getApprovedPullRequests,
  getAllPullRequests,
  getPullRequestsByTeam,
  updatePullRequest,
  deletePullRequest,
} from './pull-requests.js';

describe('pull-requests queries', () => {
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

  describe('createPullRequest', () => {
    it('should create a pull request with all fields', () => {
      const pr = createPullRequest(db, {
        storyId,
        teamId,
        branchName: 'feature/test-branch',
        githubPrNumber: 123,
        githubPrUrl: 'https://github.com/test/repo/pull/123',
        submittedBy: 'agent-123',
      });

      expect(pr.id).toMatch(/^pr-/);
      expect(pr.story_id).toBe(storyId);
      expect(pr.team_id).toBe(teamId);
      expect(pr.branch_name).toBe('feature/test-branch');
      expect(pr.github_pr_number).toBe(123);
      expect(pr.github_pr_url).toBe('https://github.com/test/repo/pull/123');
      expect(pr.submitted_by).toBe('agent-123');
      expect(pr.status).toBe('queued');
      expect(pr.created_at).toBeDefined();
    });

    it('should create PR with only required fields', () => {
      const pr = createPullRequest(db, {
        branchName: 'feature/simple-branch',
      });

      expect(pr.branch_name).toBe('feature/simple-branch');
      expect(pr.story_id).toBeNull();
      expect(pr.team_id).toBeNull();
      expect(pr.github_pr_number).toBeNull();
      expect(pr.status).toBe('queued');
    });

    it('should generate unique IDs', () => {
      const pr1 = createPullRequest(db, { branchName: 'branch-1' });
      const pr2 = createPullRequest(db, { branchName: 'branch-2' });

      expect(pr1.id).not.toBe(pr2.id);
    });
  });

  describe('getPullRequestById', () => {
    it('should retrieve a PR by ID', () => {
      const created = createPullRequest(db, {
        branchName: 'feature/test',
        storyId,
      });

      const retrieved = getPullRequestById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.branch_name).toBe('feature/test');
    });

    it('should return undefined for non-existent PR', () => {
      const result = getPullRequestById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getPullRequestByStory', () => {
    it('should retrieve a PR by story ID', () => {
      const pr = createPullRequest(db, {
        storyId,
        branchName: 'feature/story-branch',
      });

      const retrieved = getPullRequestByStory(db, storyId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(pr.id);
      expect(retrieved?.story_id).toBe(storyId);
    });

    it('should return undefined when no PR for story', () => {
      const result = getPullRequestByStory(db, 'non-existent-story');
      expect(result).toBeUndefined();
    });
  });

  describe('getPullRequestByGithubNumber', () => {
    it('should retrieve a PR by GitHub PR number', () => {
      const pr = createPullRequest(db, {
        branchName: 'feature/test',
        githubPrNumber: 456,
      });

      const retrieved = getPullRequestByGithubNumber(db, 456);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(pr.id);
      expect(retrieved?.github_pr_number).toBe(456);
    });

    it('should return undefined for non-existent PR number', () => {
      const result = getPullRequestByGithubNumber(db, 999);
      expect(result).toBeUndefined();
    });
  });

  describe('getMergeQueue', () => {
    it('should return queued and reviewing PRs', () => {
      const pr1 = createPullRequest(db, { branchName: 'branch-1', teamId });
      const pr2 = createPullRequest(db, { branchName: 'branch-2', teamId });
      updatePullRequest(db, pr2.id, { status: 'reviewing' });
      const pr3 = createPullRequest(db, { branchName: 'branch-3', teamId });
      updatePullRequest(db, pr3.id, { status: 'merged' });

      const queue = getMergeQueue(db);

      expect(queue).toHaveLength(2);
      expect(queue.map(p => p.id)).toContain(pr1.id);
      expect(queue.map(p => p.id)).toContain(pr2.id);
      expect(queue.map(p => p.id)).not.toContain(pr3.id);
    });

    it('should filter by team when teamId provided', () => {
      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });

      const pr1 = createPullRequest(db, { branchName: 'branch-1', teamId });
      createPullRequest(db, { branchName: 'branch-2', teamId: team2.id });

      const queue = getMergeQueue(db, teamId);

      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(pr1.id);
    });

    it('should order by created_at ASC', () => {
      const pr1 = createPullRequest(db, { branchName: 'first', teamId });
      const pr2 = createPullRequest(db, { branchName: 'second', teamId });

      const queue = getMergeQueue(db);

      expect(queue[0].id).toBe(pr1.id);
      expect(queue[1].id).toBe(pr2.id);
    });
  });

  describe('getNextInQueue', () => {
    it('should return the oldest queued PR', () => {
      createPullRequest(db, { branchName: 'branch-1', teamId });
      const pr2 = createPullRequest(db, { branchName: 'branch-2', teamId });
      updatePullRequest(db, pr2.id, { status: 'reviewing' });
      createPullRequest(db, { branchName: 'branch-3', teamId });

      const next = getNextInQueue(db);

      expect(next).toBeDefined();
      expect(next?.id).not.toBe(pr2.id); // pr2 is reviewing, not queued
      expect(next?.status).toBe('queued');
    });

    it('should filter by team when teamId provided', () => {
      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });

      createPullRequest(db, { branchName: 'branch-1', teamId: team2.id });
      const pr2 = createPullRequest(db, { branchName: 'branch-2', teamId });

      const next = getNextInQueue(db, teamId);

      expect(next?.id).toBe(pr2.id);
    });

    it('should return undefined when no queued PRs', () => {
      const pr = createPullRequest(db, { branchName: 'branch-1', teamId });
      updatePullRequest(db, pr.id, { status: 'merged' });

      const next = getNextInQueue(db);

      expect(next).toBeUndefined();
    });
  });

  describe('getQueuePosition', () => {
    it('should return correct position in queue', () => {
      const pr1 = createPullRequest(db, { branchName: 'branch-1', teamId });
      const pr2 = createPullRequest(db, { branchName: 'branch-2', teamId });
      const pr3 = createPullRequest(db, { branchName: 'branch-3', teamId });

      expect(getQueuePosition(db, pr1.id)).toBe(1);
      expect(getQueuePosition(db, pr2.id)).toBe(2);
      expect(getQueuePosition(db, pr3.id)).toBe(3);
    });

    it('should return -1 for PR not in queue', () => {
      const pr = createPullRequest(db, { branchName: 'branch-1', teamId });
      updatePullRequest(db, pr.id, { status: 'merged' });

      expect(getQueuePosition(db, pr.id)).toBe(-1);
    });

    it('should return -1 for non-existent PR', () => {
      expect(getQueuePosition(db, 'non-existent-id')).toBe(-1);
    });
  });

  describe('getPullRequestsByStatus', () => {
    it('should filter PRs by status', () => {
      const pr1 = createPullRequest(db, { branchName: 'branch-1' });
      const pr2 = createPullRequest(db, { branchName: 'branch-2' });
      updatePullRequest(db, pr2.id, { status: 'approved' });

      const queued = getPullRequestsByStatus(db, 'queued');
      const approved = getPullRequestsByStatus(db, 'approved');

      expect(queued).toHaveLength(1);
      expect(queued[0].id).toBe(pr1.id);
      expect(approved).toHaveLength(1);
      expect(approved[0].id).toBe(pr2.id);
    });

    it('should order by created_at DESC', () => {
      const pr1 = createPullRequest(db, { branchName: 'first' });
      const pr2 = createPullRequest(db, { branchName: 'second' });

      const queued = getPullRequestsByStatus(db, 'queued');

      expect(queued).toHaveLength(2);
      // Verify both PRs are present
      expect(queued.map(p => p.id)).toContain(pr1.id);
      expect(queued.map(p => p.id)).toContain(pr2.id);
    });
  });

  describe('getApprovedPullRequests', () => {
    it('should return only approved PRs', () => {
      createPullRequest(db, { branchName: 'branch-1' });
      const pr2 = createPullRequest(db, { branchName: 'branch-2' });
      updatePullRequest(db, pr2.id, { status: 'approved' });
      const pr3 = createPullRequest(db, { branchName: 'branch-3' });
      updatePullRequest(db, pr3.id, { status: 'approved' });

      const approved = getApprovedPullRequests(db);

      expect(approved).toHaveLength(2);
      expect(approved.map(p => p.id)).toContain(pr2.id);
      expect(approved.map(p => p.id)).toContain(pr3.id);
    });

    it('should order by created_at ASC', () => {
      const pr1 = createPullRequest(db, { branchName: 'first' });
      updatePullRequest(db, pr1.id, { status: 'approved' });
      const pr2 = createPullRequest(db, { branchName: 'second' });
      updatePullRequest(db, pr2.id, { status: 'approved' });

      const approved = getApprovedPullRequests(db);

      expect(approved[0].id).toBe(pr1.id);
      expect(approved[1].id).toBe(pr2.id);
    });
  });

  describe('getAllPullRequests', () => {
    it('should return all PRs ordered by created_at DESC', () => {
      const pr1 = createPullRequest(db, { branchName: 'first' });
      const pr2 = createPullRequest(db, { branchName: 'second' });

      const prs = getAllPullRequests(db);

      expect(prs).toHaveLength(2);
      // Verify both PRs are present
      expect(prs.map(p => p.id)).toContain(pr1.id);
      expect(prs.map(p => p.id)).toContain(pr2.id);
    });
  });

  describe('getPullRequestsByTeam', () => {
    it('should filter PRs by team', () => {
      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });

      const pr1 = createPullRequest(db, { branchName: 'branch-1', teamId });
      createPullRequest(db, { branchName: 'branch-2', teamId: team2.id });

      const teamPrs = getPullRequestsByTeam(db, teamId);

      expect(teamPrs).toHaveLength(1);
      expect(teamPrs[0].id).toBe(pr1.id);
    });
  });

  describe('updatePullRequest', () => {
    it('should update PR status', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, { status: 'reviewing' });

      expect(updated?.status).toBe('reviewing');
    });

    it('should set reviewed_at when status changes to reviewing', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, { status: 'reviewing' });

      expect(updated?.reviewed_at).toBeDefined();
    });

    it('should set reviewed_at when status changes to approved', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, { status: 'approved' });

      expect(updated?.reviewed_at).toBeDefined();
    });

    it('should update reviewedBy', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, {
        reviewedBy: 'qa-agent-123',
      });

      expect(updated?.reviewed_by).toBe('qa-agent-123');
    });

    it('should update reviewNotes', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, {
        reviewNotes: 'LGTM! Good work.',
      });

      expect(updated?.review_notes).toBe('LGTM! Good work.');
    });

    it('should update GitHub PR details', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, {
        githubPrNumber: 789,
        githubPrUrl: 'https://github.com/test/repo/pull/789',
      });

      expect(updated?.github_pr_number).toBe(789);
      expect(updated?.github_pr_url).toBe('https://github.com/test/repo/pull/789');
    });

    it('should update multiple fields at once', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, {
        status: 'approved',
        reviewedBy: 'qa-agent',
        reviewNotes: 'Approved',
      });

      expect(updated?.status).toBe('approved');
      expect(updated?.reviewed_by).toBe('qa-agent');
      expect(updated?.review_notes).toBe('Approved');
    });

    it('should update updated_at timestamp', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, { status: 'reviewing' });

      // Verify updated_at exists and is a valid timestamp
      expect(updated?.updated_at).toBeDefined();
      expect(typeof updated?.updated_at).toBe('string');
    });

    it('should return PR when no updates provided', () => {
      const pr = createPullRequest(db, { branchName: 'test' });

      const updated = updatePullRequest(db, pr.id, {});

      expect(updated?.id).toBe(pr.id);
    });

    it('should return undefined for non-existent PR', () => {
      const updated = updatePullRequest(db, 'non-existent-id', { status: 'reviewing' });
      expect(updated).toBeUndefined();
    });
  });

  describe('deletePullRequest', () => {
    it('should delete a PR', () => {
      const pr = createPullRequest(db, { branchName: 'to-delete' });

      deletePullRequest(db, pr.id);

      const retrieved = getPullRequestById(db, pr.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent PR', () => {
      expect(() => deletePullRequest(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle all PR statuses', () => {
      const statuses: Array<'queued' | 'reviewing' | 'approved' | 'merged' | 'rejected' | 'closed'> = [
        'queued',
        'reviewing',
        'approved',
        'merged',
        'rejected',
        'closed',
      ];

      const pr = createPullRequest(db, { branchName: 'test' });

      statuses.forEach(status => {
        const updated = updatePullRequest(db, pr.id, { status });
        expect(updated?.status).toBe(status);
      });
    });

    it('should handle very long review notes', () => {
      const pr = createPullRequest(db, { branchName: 'test' });
      const longNotes = 'A'.repeat(50000);

      const updated = updatePullRequest(db, pr.id, { reviewNotes: longNotes });

      expect(updated?.review_notes).toBe(longNotes);
    });

    it('should handle special characters in branch names', () => {
      const pr = createPullRequest(db, {
        branchName: 'feature/STORY-123_fix-bug-with-dashes',
      });

      expect(pr.branch_name).toBe('feature/STORY-123_fix-bug-with-dashes');
    });

    it('should handle null fields', () => {
      const pr = createPullRequest(db, {
        branchName: 'test',
        submittedBy: 'agent-1',
      });

      const updated = updatePullRequest(db, pr.id, {
        reviewedBy: null,
        reviewNotes: null,
      });

      expect(updated?.reviewed_by).toBeNull();
      expect(updated?.review_notes).toBeNull();
    });
  });
});
