import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlitePullRequestDao } from '../sqlite/pull-request.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('SqlitePullRequestDao', () => {
  let db: Database;
  let dao: SqlitePullRequestDao;
  let teamDao: SqliteTeamDao;
  let storyDao: SqliteStoryDao;
  let teamId: string;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqlitePullRequestDao(db);
    teamDao = new SqliteTeamDao(db);
    storyDao = new SqliteStoryDao(db);
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    teamId = team.id;
  });

  afterEach(() => {
    db.close();
  });

  it('pull-request.sqlite-dao case 1', async () => {
    const pr = await dao.createPullRequest({
      branchName: 'feature/login',
      teamId,
      submittedBy: 'agent-1',
    });

    expect(pr.id).toMatch(/^pr-/);
    expect(pr.branch_name).toBe('feature/login');
    expect(pr.team_id).toBe(teamId);
    expect(pr.status).toBe('queued');
    expect(pr.submitted_by).toBe('agent-1');
  });

  it('pull-request.sqlite-dao case 2', async () => {
    const story = await storyDao.createStory({ title: 'S1', description: 'D1', teamId });
    const pr = await dao.createPullRequest({
      branchName: 'feature/story',
      storyId: story.id,
      teamId,
    });
    expect(pr.story_id).toBe(story.id);
  });

  it('pull-request.sqlite-dao case 3', async () => {
    const created = await dao.createPullRequest({ branchName: 'branch', teamId });
    const found = await dao.getPullRequestById(created.id);
    expect(found).toEqual(created);
  });

  it('pull-request.sqlite-dao case 4', async () => {
    expect(await dao.getPullRequestById('pr-nope')).toBeUndefined();
  });

  it('pull-request.sqlite-dao case 5', async () => {
    const story = await storyDao.createStory({ title: 'S1', description: 'D1', teamId });
    const pr = await dao.createPullRequest({ branchName: 'branch', storyId: story.id, teamId });

    const found = await dao.getPullRequestByStory(story.id);
    expect(found!.id).toBe(pr.id);
  });

  it('pull-request.sqlite-dao case 6', async () => {
    const pr = await dao.createPullRequest({
      branchName: 'branch',
      teamId,
      githubPrNumber: 42,
    });

    const found = await dao.getPullRequestByGithubNumber(42);
    expect(found!.id).toBe(pr.id);
  });

  it('pull-request.sqlite-dao case 7', async () => {
    await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.createPullRequest({ branchName: 'b2', teamId });
    const pr3 = await dao.createPullRequest({ branchName: 'b3', teamId });
    await dao.updatePullRequest(pr3.id, { status: 'merged' });

    const queue = await dao.getMergeQueue(teamId);
    expect(queue).toHaveLength(2);
    expect(queue[0].branch_name).toBe('b1');
    expect(queue[1].branch_name).toBe('b2');
  });

  it('pull-request.sqlite-dao case 8', async () => {
    await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.createPullRequest({ branchName: 'b2' });

    const queue = await dao.getMergeQueue();
    expect(queue).toHaveLength(2);
  });

  it('pull-request.sqlite-dao case 9', async () => {
    await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.createPullRequest({ branchName: 'b2', teamId });

    const next = await dao.getNextInQueue(teamId);
    expect(next!.branch_name).toBe('b1');
  });

  it('pull-request.sqlite-dao case 10', async () => {
    expect(await dao.getNextInQueue(teamId)).toBeUndefined();
  });

  it('pull-request.sqlite-dao case 11', async () => {
    const pr1 = await dao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await dao.createPullRequest({ branchName: 'b2', teamId });

    expect(await dao.getQueuePosition(pr1.id)).toBe(1);
    expect(await dao.getQueuePosition(pr2.id)).toBe(2);
  });

  it('pull-request.sqlite-dao case 12', async () => {
    const pr = await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.updatePullRequest(pr.id, { status: 'merged' });

    expect(await dao.getQueuePosition(pr.id)).toBe(-1);
  });

  it('pull-request.sqlite-dao case 13', async () => {
    expect(await dao.getQueuePosition('pr-nope')).toBe(-1);
  });

  it('pull-request.sqlite-dao case 14', async () => {
    const pr = await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.updatePullRequest(pr.id, { status: 'approved' });

    const approved = await dao.getPullRequestsByStatus('approved');
    expect(approved).toHaveLength(1);
  });

  it('pull-request.sqlite-dao case 15', async () => {
    const pr1 = await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.createPullRequest({ branchName: 'b2', teamId });
    await dao.updatePullRequest(pr1.id, { status: 'approved' });

    const approved = await dao.getApprovedPullRequests();
    expect(approved).toHaveLength(1);
  });

  it('pull-request.sqlite-dao case 16', async () => {
    await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.createPullRequest({ branchName: 'b2', teamId });

    const all = await dao.getAllPullRequests();
    expect(all).toHaveLength(2);
  });

  it('pull-request.sqlite-dao case 17', async () => {
    await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.createPullRequest({ branchName: 'b2' }); // no team

    const byTeam = await dao.getPullRequestsByTeam(teamId);
    expect(byTeam).toHaveLength(1);
  });

  it('pull-request.sqlite-dao case 18', async () => {
    const pr = await dao.createPullRequest({ branchName: 'b1', teamId });
    expect(pr.reviewed_at).toBeNull();

    const updated = await dao.updatePullRequest(pr.id, { status: 'approved' });
    expect(updated!.reviewed_at).toBeDefined();
    expect(updated!.reviewed_at).not.toBeNull();
  });

  it('pull-request.sqlite-dao case 19', async () => {
    const pr = await dao.createPullRequest({ branchName: 'b1', teamId });
    const updated = await dao.updatePullRequest(pr.id, { reviewNotes: 'note' });
    expect(updated!.reviewed_at).toBeNull();
  });

  it('pull-request.sqlite-dao case 20', async () => {
    const pr = await dao.createPullRequest({ branchName: 'b1', teamId });
    await dao.deletePullRequest(pr.id);
    expect(await dao.getPullRequestById(pr.id)).toBeUndefined();
  });
});
