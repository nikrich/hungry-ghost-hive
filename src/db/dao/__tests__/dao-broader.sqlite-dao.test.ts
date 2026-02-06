import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteEscalationDao } from '../sqlite/escalation.sqlite-dao.js';
import { SqliteLogDao } from '../sqlite/log.sqlite-dao.js';
import { SqliteMessageDao } from '../sqlite/message.sqlite-dao.js';
import { SqlitePullRequestDao } from '../sqlite/pull-request.sqlite-dao.js';
import { SqliteRequirementDao } from '../sqlite/requirement.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('Broader DAO contract', () => {
  let db: Database;
  let teamDao: SqliteTeamDao;
  let agentDao: SqliteAgentDao;
  let storyDao: SqliteStoryDao;
  let reqDao: SqliteRequirementDao;
  let prDao: SqlitePullRequestDao;
  let escDao: SqliteEscalationDao;
  let logDao: SqliteLogDao;
  let msgDao: SqliteMessageDao;
  let teamId: string;

  beforeEach(async () => {
    db = await createTestDb();
    teamDao = new SqliteTeamDao(db);
    agentDao = new SqliteAgentDao(db);
    storyDao = new SqliteStoryDao(db);
    reqDao = new SqliteRequirementDao(db);
    prDao = new SqlitePullRequestDao(db);
    escDao = new SqliteEscalationDao(db);
    logDao = new SqliteLogDao(db);
    msgDao = new SqliteMessageDao(db);

    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    teamId = team.id;
  });

  afterEach(() => {
    db.close();
  });

  it('dao-broader.sqlite-dao case 1', async () => {
    const t1 = await teamDao.createTeam({ repoUrl: 'url1', repoPath: '/p1', name: 'Team 1' });
    const t2 = await teamDao.createTeam({ repoUrl: 'url2', repoPath: '/p2', name: 'Team 2' });

    db.run('UPDATE teams SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', teamId]);
    db.run('UPDATE teams SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', t1.id]);
    db.run('UPDATE teams SET created_at = ? WHERE id = ?', ['2025-01-03T00:00:00.000Z', t2.id]);

    const all = await teamDao.getAllTeams();
    expect(all.map(team => team.id)).toEqual([t1.id, teamId, t2.id]);
  });

  it('dao-broader.sqlite-dao case 2', async () => {
    const r1 = await reqDao.createRequirement({ title: 'Old', description: 'Desc' });
    const r2 = await reqDao.createRequirement({ title: 'New', description: 'Desc' });
    await reqDao.updateRequirement(r1.id, { status: 'planned' });
    await reqDao.updateRequirement(r2.id, { status: 'planned' });

    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      r1.id,
    ]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      r2.id,
    ]);

    const planned = await reqDao.getRequirementsByStatus('planned');
    expect(planned.map(req => req.id)).toEqual([r2.id, r1.id]);
  });

  it('dao-broader.sqlite-dao case 3', async () => {
    const r1 = await reqDao.createRequirement({ title: 'Old', description: 'Desc' });
    const r2 = await reqDao.createRequirement({ title: 'New', description: 'Desc' });

    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      r1.id,
    ]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      r2.id,
    ]);

    const pending = await reqDao.getPendingRequirements();
    expect(pending.map(req => req.id)).toEqual([r1.id, r2.id]);
  });

  it('dao-broader.sqlite-dao case 4', async () => {
    const req = await reqDao.createRequirement({
      title: 'Original',
      description: 'Desc',
      submittedBy: 'tech-lead',
    });
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      req.id,
    ]);

    const updated = await reqDao.updateRequirement(req.id, { title: 'Updated' });
    expect(updated!.submitted_by).toBe('tech-lead');
    expect(updated!.created_at).toBe('2025-01-01T00:00:00.000Z');
  });

  it('dao-broader.sqlite-dao case 5', async () => {
    const req = await reqDao.createRequirement({ title: 'Req', description: 'Desc' });
    const s1 = await storyDao.createStory({
      title: 'Old',
      description: 'D1',
      requirementId: req.id,
    });
    const s2 = await storyDao.createStory({
      title: 'New',
      description: 'D2',
      requirementId: req.id,
    });

    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const stories = await storyDao.getStoriesByRequirement(req.id);
    expect(stories.map(story => story.id)).toEqual([s1.id, s2.id]);
  });

  it('dao-broader.sqlite-dao case 6', async () => {
    const s1 = await storyDao.createStory({ title: 'Old', description: 'D1' });
    const s2 = await storyDao.createStory({ title: 'New', description: 'D2' });

    await storyDao.updateStory(s1.id, { status: 'planned', storyPoints: 5 });
    await storyDao.updateStory(s2.id, { status: 'planned', storyPoints: 5 });

    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const planned = await storyDao.getPlannedStories();
    expect(planned.map(story => story.id)).toEqual([s1.id, s2.id]);
  });

  it('dao-broader.sqlite-dao case 7', async () => {
    const s1 = await storyDao.createStory({ title: 'Old', description: 'D1' });
    const s2 = await storyDao.createStory({ title: 'New', description: 'D2' });

    await storyDao.updateStory(s1.id, { status: 'in_progress' });
    await storyDao.updateStory(s2.id, { status: 'review' });

    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const inProgress = await storyDao.getInProgressStories();
    expect(inProgress.map(story => story.id)).toEqual([s1.id, s2.id]);
  });

  it('dao-broader.sqlite-dao case 8', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const story = await storyDao.createStory({ title: 'Story', description: 'Desc' });
    await storyDao.updateStory(story.id, { assignedAgentId: agent.id });

    const updated = await storyDao.updateStory(story.id, { assignedAgentId: null });
    expect(updated!.assigned_agent_id).toBeNull();
  });

  it('dao-broader.sqlite-dao case 9', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const story = await storyDao.createStory({ title: 'Story', description: 'Desc', teamId });
    await storyDao.updateStory(story.id, { assignedAgentId: agent.id });

    const orphaned = await storyDao.getStoriesWithOrphanedAssignments();
    expect(orphaned).toEqual([]);
  });

  it('dao-broader.sqlite-dao case 10', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    db.run('UPDATE agents SET updated_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', agent.id]);

    const updated = await agentDao.updateAgent(agent.id, { status: 'working' });
    expect(updated!.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('dao-broader.sqlite-dao case 11', async () => {
    await agentDao.createAgent({ type: 'senior' });
    const assigned = await agentDao.createAgent({ type: 'junior', teamId });

    const agents = await agentDao.getAgentsByTeam(teamId);
    expect(agents.map(agent => agent.id)).toEqual([assigned.id]);
  });

  it('dao-broader.sqlite-dao case 12', async () => {
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });

    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      pr1.id,
    ]);
    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      pr2.id,
    ]);

    const queue = await prDao.getMergeQueue(teamId);
    expect(queue.map(pr => pr.id)).toEqual([pr1.id, pr2.id]);
  });

  it('dao-broader.sqlite-dao case 13', async () => {
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });
    await prDao.updatePullRequest(pr1.id, { status: 'approved' });
    await prDao.updatePullRequest(pr2.id, { status: 'approved' });

    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      pr1.id,
    ]);
    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      pr2.id,
    ]);

    const approved = await prDao.getApprovedPullRequests();
    expect(approved.map(pr => pr.id)).toEqual([pr2.id, pr1.id]);
  });

  it('dao-broader.sqlite-dao case 14', async () => {
    const pr = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const updated = await prDao.updatePullRequest(pr.id, { status: 'queued' });
    expect(updated!.reviewed_at).toBeNull();
  });

  it('dao-broader.sqlite-dao case 15', async () => {
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });
    await prDao.updatePullRequest(pr1.id, { status: 'rejected' });
    await prDao.updatePullRequest(pr2.id, { status: 'rejected' });

    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      pr1.id,
    ]);
    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      pr2.id,
    ]);

    const rejected = await prDao.getPullRequestsByStatus('rejected');
    expect(rejected.map(pr => pr.id)).toEqual([pr2.id, pr1.id]);
  });

  it('dao-broader.sqlite-dao case 16', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const story = await storyDao.createStory({ title: 'Story', description: 'Desc', teamId });
    const e1 = await escDao.createEscalation({
      storyId: story.id,
      fromAgentId: agent.id,
      reason: 'Old',
    });
    const e2 = await escDao.createEscalation({
      storyId: story.id,
      fromAgentId: agent.id,
      reason: 'New',
    });

    db.run('UPDATE escalations SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      e1.id,
    ]);
    db.run('UPDATE escalations SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      e2.id,
    ]);

    const escalations = await escDao.getEscalationsByStory(story.id);
    expect(escalations.map(esc => esc.id)).toEqual([e2.id, e1.id]);
  });

  it('dao-broader.sqlite-dao case 17', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const e1 = await escDao.createEscalation({ fromAgentId: agent.id, reason: 'Old' });
    const e2 = await escDao.createEscalation({ fromAgentId: agent.id, reason: 'New' });

    db.run('UPDATE escalations SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      e1.id,
    ]);
    db.run('UPDATE escalations SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      e2.id,
    ]);

    const pending = await escDao.getPendingHumanEscalations();
    expect(pending.map(esc => esc.id)).toEqual([e1.id, e2.id]);
  });

  it('dao-broader.sqlite-dao case 18', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const reviewer = await agentDao.createAgent({ type: 'tech_lead', teamId });
    const esc = await escDao.createEscalation({
      fromAgentId: agent.id,
      toAgentId: reviewer.id,
      reason: 'Needs review',
    });

    const updated = await escDao.updateEscalation(esc.id, { toAgentId: null });
    expect(updated!.to_agent_id).toBeNull();
  });

  it('dao-broader.sqlite-dao case 19', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const log = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });
    expect(log.metadata).toBeNull();
  });

  it('dao-broader.sqlite-dao case 20', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const l1 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });
    const l2 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });

    db.run('UPDATE agent_logs SET timestamp = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', l1.id]);
    db.run('UPDATE agent_logs SET timestamp = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', l2.id]);

    const logs = await logDao.getLogsByEventType('AGENT_SPAWNED');
    expect(logs.map(log => log.id)).toEqual([l2.id, l1.id]);
  });

  it('dao-broader.sqlite-dao case 21', async () => {
    db.run(
      `INSERT INTO messages (id, from_session, to_session, body, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      ['m1', 'a', 'b', 'First', '2025-01-02T00:00:00.000Z']
    );
    db.run(
      `INSERT INTO messages (id, from_session, to_session, body, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      ['m2', 'a', 'b', 'Second', '2025-01-01T00:00:00.000Z']
    );

    const pending = await msgDao.getAllPendingMessages();
    expect(pending.map(msg => msg.id)).toEqual(['m2', 'm1']);
  });

  it('dao-broader.sqlite-dao case 22', async () => {
    const alpha = await teamDao.createTeam({ repoUrl: 'url-a', repoPath: '/a', name: 'Alpha' });

    const found = await teamDao.getTeamByName('Alpha');
    const missing = await teamDao.getTeamByName('Missing');

    expect(found!.id).toBe(alpha.id);
    expect(missing).toBeUndefined();
  });

  it('dao-broader.sqlite-dao case 23', async () => {
    const t1 = await teamDao.createTeam({ repoUrl: 'url-1', repoPath: '/one', name: 'One' });
    const t2 = await teamDao.createTeam({ repoUrl: 'url-2', repoPath: '/two', name: 'Two' });

    await teamDao.deleteTeam(t1.id);

    const ids = (await teamDao.getAllTeams()).map(team => team.id);
    expect(ids).toContain(teamId);
    expect(ids).toContain(t2.id);
    expect(ids).not.toContain(t1.id);
  });

  it('dao-broader.sqlite-dao case 24', async () => {
    const senior = await agentDao.createAgent({ type: 'senior', teamId });
    await agentDao.createAgent({ type: 'junior', teamId });

    const seniors = await agentDao.getAgentsByType('senior');
    expect(seniors.map(agent => agent.id)).toEqual([senior.id]);
  });

  it('dao-broader.sqlite-dao case 25', async () => {
    const idle = await agentDao.createAgent({ type: 'senior', teamId });
    const working = await agentDao.createAgent({ type: 'junior', teamId });

    await agentDao.updateAgent(working.id, { status: 'working' });

    const workingAgents = await agentDao.getAgentsByStatus('working');
    const ids = workingAgents.map(agent => agent.id);
    expect(ids).toContain(working.id);
    expect(ids).not.toContain(idle.id);
  });

  it('dao-broader.sqlite-dao case 26', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId, tmuxSession: 'tmux-1' });
    await agentDao.terminateAgent(agent.id);

    const updated = await agentDao.getAgentById(agent.id);
    expect(updated!.status).toBe('terminated');
    expect(updated!.tmux_session).toBeNull();
  });

  it('dao-broader.sqlite-dao case 27', async () => {
    const s1 = await storyDao.createStory({ title: 'Old', description: 'D1' });
    const s2 = await storyDao.createStory({ title: 'New', description: 'D2' });

    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const all = await storyDao.getAllStories();
    expect(all.map(story => story.id)).toEqual([s2.id, s1.id]);
  });

  it('dao-broader.sqlite-dao case 28', async () => {
    const otherTeam = await teamDao.createTeam({ repoUrl: 'url-o', repoPath: '/o', name: 'Other' });
    const s1 = await storyDao.createStory({ title: 'Old', description: 'D1', teamId });
    const s2 = await storyDao.createStory({ title: 'New', description: 'D2', teamId });
    await storyDao.createStory({ title: 'Other', description: 'D3', teamId: otherTeam.id });

    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const teamStories = await storyDao.getStoriesByTeam(teamId);
    expect(teamStories.map(story => story.id)).toEqual([s1.id, s2.id]);
  });

  it('dao-broader.sqlite-dao case 29', async () => {
    const s1 = await storyDao.createStory({ title: 'Old', description: 'D1' });
    const s2 = await storyDao.createStory({ title: 'New', description: 'D2' });

    await storyDao.updateStory(s1.id, { status: 'planned' });
    await storyDao.updateStory(s2.id, { status: 'planned' });

    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', s1.id]);
    db.run('UPDATE stories SET created_at = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', s2.id]);

    const planned = await storyDao.getStoriesByStatus('planned');
    expect(planned.map(story => story.id)).toEqual([s1.id, s2.id]);
  });

  it('dao-broader.sqlite-dao case 30', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const planned = await storyDao.createStory({ title: 'Planned', description: 'D1' });
    const review = await storyDao.createStory({ title: 'Review', description: 'D2' });
    const merged = await storyDao.createStory({ title: 'Merged', description: 'D3' });

    await storyDao.updateStory(planned.id, { status: 'planned', assignedAgentId: agent.id });
    await storyDao.updateStory(review.id, { status: 'review', assignedAgentId: agent.id });
    await storyDao.updateStory(merged.id, { status: 'merged', assignedAgentId: agent.id });

    const active = await storyDao.getActiveStoriesByAgent(agent.id);
    const ids = active.map(story => story.id);
    expect(ids).toContain(planned.id);
    expect(ids).toContain(review.id);
    expect(ids).not.toContain(merged.id);
  });

  it('dao-broader.sqlite-dao case 31', async () => {
    const s1 = await storyDao.createStory({ title: 'Planned', description: 'D1', teamId });
    const s2 = await storyDao.createStory({ title: 'In Progress', description: 'D2', teamId });
    const s3 = await storyDao.createStory({ title: 'Review', description: 'D3', teamId });
    const s4 = await storyDao.createStory({ title: 'QA', description: 'D4', teamId });
    const s5 = await storyDao.createStory({ title: 'Merged', description: 'D5', teamId });

    await storyDao.updateStory(s1.id, { status: 'planned', storyPoints: 3 });
    await storyDao.updateStory(s2.id, { status: 'in_progress', storyPoints: 5 });
    await storyDao.updateStory(s3.id, { status: 'review', storyPoints: 2 });
    await storyDao.updateStory(s4.id, { status: 'qa', storyPoints: 1 });
    await storyDao.updateStory(s5.id, { status: 'merged', storyPoints: 8 });

    const total = await storyDao.getStoryPointsByTeam(teamId);
    expect(total).toBe(11);
  });

  it('dao-broader.sqlite-dao case 32', async () => {
    const base = await storyDao.createStory({ title: 'Base', description: 'D1' });
    const dependent = await storyDao.createStory({ title: 'Dependent', description: 'D2' });

    await storyDao.addStoryDependency(dependent.id, base.id);
    await storyDao.deleteStory(base.id);

    const depending = await storyDao.getStoriesDependingOn(base.id);
    expect(depending).toEqual([]);
  });

  it('dao-broader.sqlite-dao case 33', async () => {
    const r1 = await reqDao.createRequirement({ title: 'First', description: 'Desc' });
    const r2 = await reqDao.createRequirement({ title: 'Second', description: 'Desc' });
    const sameTime = '2025-01-01T00:00:00.000Z';

    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, r1.id]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, r2.id]);

    const all = await reqDao.getAllRequirements();
    expect(all.map(req => req.id)).toEqual([r2.id, r1.id]);
  });

  it('dao-broader.sqlite-dao case 34', async () => {
    const rPending = await reqDao.createRequirement({ title: 'Pending', description: 'Desc' });
    const rPlanning = await reqDao.createRequirement({ title: 'Planning', description: 'Desc' });
    const rInProgress = await reqDao.createRequirement({
      title: 'In Progress',
      description: 'Desc',
    });
    const rDone = await reqDao.createRequirement({ title: 'Done', description: 'Desc' });

    await reqDao.updateRequirement(rPlanning.id, { status: 'planning' });
    await reqDao.updateRequirement(rInProgress.id, { status: 'in_progress' });
    await reqDao.updateRequirement(rDone.id, { status: 'completed' });

    const sameTime = '2025-01-01T00:00:00.000Z';
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, rPending.id]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, rPlanning.id]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, rInProgress.id]);
    db.run('UPDATE requirements SET created_at = ? WHERE id = ?', [sameTime, rDone.id]);

    const pending = await reqDao.getPendingRequirements();
    expect(pending.map(req => req.id)).toEqual([rPending.id, rPlanning.id, rInProgress.id]);
  });

  it('dao-broader.sqlite-dao case 35', async () => {
    const pr = await prDao.createPullRequest({
      branchName: 'branch',
      teamId,
      githubPrNumber: 123,
      githubPrUrl: 'https://example.com/pr/123',
    });

    const found = await prDao.getPullRequestByGithubNumber(123);
    expect(found!.id).toBe(pr.id);
  });

  it('dao-broader.sqlite-dao case 36', async () => {
    const pr = await prDao.createPullRequest({ branchName: 'branch', teamId });
    const updated = await prDao.updatePullRequest(pr.id, {
      status: 'approved',
      reviewedBy: 'lead',
    });

    expect(updated!.status).toBe('approved');
    expect(updated!.reviewed_at).not.toBeNull();
  });

  it('dao-broader.sqlite-dao case 37', async () => {
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });

    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      pr1.id,
    ]);
    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      pr2.id,
    ]);

    await prDao.updatePullRequest(pr1.id, { status: 'reviewing' });

    const next = await prDao.getNextInQueue(teamId);
    expect(next!.id).toBe(pr2.id);
  });

  it('dao-broader.sqlite-dao case 38', async () => {
    const pr = await prDao.createPullRequest({ branchName: 'b1', teamId });
    await prDao.updatePullRequest(pr.id, { status: 'merged' });

    const position = await prDao.getQueuePosition(pr.id);
    expect(position).toBe(-1);
  });

  it('dao-broader.sqlite-dao case 39', async () => {
    const agent1 = await agentDao.createAgent({ type: 'senior', teamId });
    const agent2 = await agentDao.createAgent({ type: 'junior', teamId });
    const e1 = await escDao.createEscalation({ fromAgentId: agent1.id, reason: 'Old' });
    const e2 = await escDao.createEscalation({ fromAgentId: agent1.id, reason: 'New' });
    await escDao.createEscalation({ fromAgentId: agent2.id, reason: 'Other' });

    db.run('UPDATE escalations SET created_at = ? WHERE id = ?', [
      '2025-01-01T00:00:00.000Z',
      e1.id,
    ]);
    db.run('UPDATE escalations SET created_at = ? WHERE id = ?', [
      '2025-01-02T00:00:00.000Z',
      e2.id,
    ]);

    const fromAgent1 = await escDao.getEscalationsByFromAgent(agent1.id);
    expect(fromAgent1.map(esc => esc.id)).toEqual([e2.id, e1.id]);
  });

  it('dao-broader.sqlite-dao case 40', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const l1 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });
    const l2 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });
    const l3 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });

    db.run('UPDATE agent_logs SET timestamp = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', l1.id]);
    db.run('UPDATE agent_logs SET timestamp = ? WHERE id = ?', ['2025-01-02T00:00:00.000Z', l2.id]);
    db.run('UPDATE agent_logs SET timestamp = ? WHERE id = ?', ['2025-01-03T00:00:00.000Z', l3.id]);

    const since = await logDao.getLogsSince('2025-01-01T12:00:00.000Z');
    expect(since.map(log => log.id)).toEqual([l2.id, l3.id]);
  });

  it('dao-broader.sqlite-dao case 41', async () => {
    db.run(
      `INSERT INTO messages (id, from_session, to_session, subject, body, reply, status, created_at, replied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['m1', 'a', 'b', null, 'First', null, 'pending', '2025-01-02T00:00:00.000Z', null]
    );
    db.run(
      `INSERT INTO messages (id, from_session, to_session, subject, body, reply, status, created_at, replied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['m2', 'a', 'b', null, 'Second', null, 'pending', '2025-01-01T00:00:00.000Z', null]
    );
    db.run(
      `INSERT INTO messages (id, from_session, to_session, subject, body, reply, status, created_at, replied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['m3', 'a', 'b', null, 'Read', null, 'read', '2025-01-03T00:00:00.000Z', null]
    );
    db.run(
      `INSERT INTO messages (id, from_session, to_session, subject, body, reply, status, created_at, replied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['m4', 'a', 'c', null, 'Other', null, 'pending', '2025-01-01T00:00:00.000Z', null]
    );

    const unread = await msgDao.getUnreadMessages('b');
    expect(unread.map(msg => msg.id)).toEqual(['m2', 'm1']);
  });
});
