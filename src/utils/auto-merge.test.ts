import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPullRequest,
  getApprovedPullRequests,
  updatePullRequest,
} from '../db/queries/pull-requests.js';
import { createStory } from '../db/queries/stories.js';
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
});
