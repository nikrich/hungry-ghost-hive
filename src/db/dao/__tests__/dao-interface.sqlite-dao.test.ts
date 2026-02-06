import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './helpers.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteRequirementDao } from '../sqlite/requirement.sqlite-dao.js';
import { SqlitePullRequestDao } from '../sqlite/pull-request.sqlite-dao.js';

describe('DAO interface contract', () => {
  let db: Database;
  let teamDao: SqliteTeamDao;
  let agentDao: SqliteAgentDao;
  let storyDao: SqliteStoryDao;
  let reqDao: SqliteRequirementDao;
  let prDao: SqlitePullRequestDao;
  let teamId: string;

  beforeEach(async () => {
    db = await createTestDb();
    teamDao = new SqliteTeamDao(db);
    agentDao = new SqliteAgentDao(db);
    storyDao = new SqliteStoryDao(db);
    reqDao = new SqliteRequirementDao(db);
    prDao = new SqlitePullRequestDao(db);

    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    teamId = team.id;
  });

  afterEach(() => {
    db.close();
  });

  it('dao-interface.sqlite-dao case 1', async () => {
    const t2 = await teamDao.createTeam({ repoUrl: 'url2', repoPath: '/p2', name: 'Team 2' });
    await teamDao.deleteTeam(teamId);
    await teamDao.deleteTeam(t2.id);

    expect(await teamDao.getAllTeams()).toEqual([]);
  });

  it('dao-interface.sqlite-dao case 2', async () => {
    await reqDao.createRequirement({ title: 'Req', description: 'Desc' });
    expect(await reqDao.getRequirementsByStatus('planned')).toEqual([]);
  });

  it('dao-interface.sqlite-dao case 3', async () => {
    const updated = await reqDao.updateRequirement('REQ-MISSING', { status: 'planned' });
    expect(updated).toBeUndefined();
  });

  it('dao-interface.sqlite-dao case 4', async () => {
    const req = await reqDao.createRequirement({ title: 'Keep', description: 'Desc' });
    await reqDao.deleteRequirement('REQ-NOPE');
    expect(await reqDao.getRequirementById(req.id)).toBeDefined();
  });

  it('dao-interface.sqlite-dao case 5', async () => {
    const req = await reqDao.createRequirement({ title: 'Pending', description: 'Desc' });
    const pending = await reqDao.getPendingRequirements();
    expect(pending.map(item => item.id)).toContain(req.id);
  });

  it('dao-interface.sqlite-dao case 6', async () => {
    const r1 = await reqDao.createRequirement({ title: 'First', description: 'Desc' });
    const r2 = await reqDao.createRequirement({ title: 'Second', description: 'Desc' });
    const sameTime = '2025-01-01T00:00:00.000Z';

    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, r1.id]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, r2.id]);

    const all = await reqDao.getAllRequirements();
    expect(all[0].id).toBe(r2.id);
    expect(all[1].id).toBe(r1.id);
  });

  it('dao-interface.sqlite-dao case 7', async () => {
    expect(await agentDao.getAgentsByTeam('team-nope')).toEqual([]);
  });

  it('dao-interface.sqlite-dao case 8', async () => {
    const updated = await agentDao.updateAgent('agent-missing', { status: 'working' });
    expect(updated).toBeUndefined();
  });

  it('dao-interface.sqlite-dao case 9', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId, tmuxSession: 'tmux-1' });
    const updated = await agentDao.updateAgent(agent.id, { tmuxSession: null });
    expect(updated!.tmux_session).toBeNull();
  });

  it('dao-interface.sqlite-dao case 10', async () => {
    const blocked = await agentDao.createAgent({ type: 'senior', teamId });
    const working = await agentDao.createAgent({ type: 'junior', teamId });
    const terminated = await agentDao.createAgent({ type: 'qa', teamId });

    await agentDao.updateAgent(blocked.id, { status: 'blocked' });
    await agentDao.updateAgent(working.id, { status: 'working' });
    await agentDao.terminateAgent(terminated.id);

    const active = await agentDao.getActiveAgents();
    const ids = active.map(agent => agent.id);
    expect(ids).toContain(blocked.id);
    expect(ids).toContain(working.id);
    expect(ids).not.toContain(terminated.id);
  });

  it('dao-interface.sqlite-dao case 11', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    db.run('UPDATE agents SET last_seen = NULL WHERE id = ?', [agent.id]);
    expect(await agentDao.isAgentHeartbeatCurrent(agent.id, 60)).toBe(false);
  });

  it('dao-interface.sqlite-dao case 12', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    db.run('UPDATE agents SET last_seen = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', agent.id]);

    const stale = await agentDao.getStaleAgents(15);
    expect(stale.map(item => item.id)).toContain(agent.id);
  });

  it('dao-interface.sqlite-dao case 13', async () => {
    expect(await storyDao.getStoriesByRequirement('REQ-NOPE')).toEqual([]);
  });

  it('dao-interface.sqlite-dao case 14', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    expect(await storyDao.getStoriesByAgent(agent.id)).toEqual([]);
  });

  it('dao-interface.sqlite-dao case 15', async () => {
    const story = await storyDao.createStory({
      title: 'Story',
      description: 'Desc',
      acceptanceCriteria: ['AC1'],
    });
    const updated = await storyDao.updateStory(story.id, { acceptanceCriteria: null });
    expect(updated!.acceptance_criteria).toBeNull();
  });

  it('dao-interface.sqlite-dao case 16', async () => {
    const story = await storyDao.createStory({ title: 'Story', description: 'Desc', teamId });
    const updated = await storyDao.updateStory(story.id, { teamId: null });
    expect(updated!.team_id).toBeNull();
  });

  it('dao-interface.sqlite-dao case 17', async () => {
    const story = await storyDao.createStory({ title: 'S1', description: 'D1' });
    expect(await storyDao.getStoriesDependingOn(story.id)).toEqual([]);
  });

  it('dao-interface.sqlite-dao case 18', async () => {
    const story = await storyDao.createStory({ title: 'Story', description: 'Desc', teamId });
    expect(await prDao.getPullRequestByStory(story.id)).toBeUndefined();
  });

  it('dao-interface.sqlite-dao case 19', async () => {
    const updated = await prDao.updatePullRequest('pr-nope', { status: 'merged' });
    expect(updated).toBeUndefined();
  });

  it('dao-interface.sqlite-dao case 20', async () => {
    const queued = await prDao.createPullRequest({ branchName: 'queued', teamId });
    const reviewing = await prDao.createPullRequest({ branchName: 'reviewing', teamId });
    const merged = await prDao.createPullRequest({ branchName: 'merged', teamId });

    await prDao.updatePullRequest(reviewing.id, { status: 'reviewing' });
    await prDao.updatePullRequest(merged.id, { status: 'merged' });

    const queue = await prDao.getMergeQueue(teamId);
    const ids = queue.map(pr => pr.id);
    expect(ids).toContain(queued.id);
    expect(ids).toContain(reviewing.id);
    expect(ids).not.toContain(merged.id);
  });
});
