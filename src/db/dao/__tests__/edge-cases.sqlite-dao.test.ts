import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './helpers.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteRequirementDao } from '../sqlite/requirement.sqlite-dao.js';
import { SqlitePullRequestDao } from '../sqlite/pull-request.sqlite-dao.js';
import { SqliteEscalationDao } from '../sqlite/escalation.sqlite-dao.js';
import { SqliteLogDao } from '../sqlite/log.sqlite-dao.js';
import { SqliteMessageDao } from '../sqlite/message.sqlite-dao.js';
import { run } from '../../client.js';

describe('DAO edge cases', () => {
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

  // --- Team: duplicate names ---
  it('edge-cases.sqlite-dao case 1', async () => {
    const t1 = await teamDao.createTeam({ repoUrl: 'u1', repoPath: '/p1', name: 'Dup' });
    const t2 = await teamDao.createTeam({ repoUrl: 'u2', repoPath: '/p2', name: 'Dup' });
    expect(t1.id).not.toBe(t2.id);
    // getTeamByName returns the first match
    const found = await teamDao.getTeamByName('Dup');
    expect(found).toBeDefined();
  });

  // --- Team: delete non-existent is a no-op ---
  it('edge-cases.sqlite-dao case 2', async () => {
    await teamDao.deleteTeam('team-does-not-exist');
    expect(await teamDao.getAllTeams()).toHaveLength(1); // only the beforeEach team
  });

  // --- Agent: create without team ---
  it('edge-cases.sqlite-dao case 3', async () => {
    const agent = await agentDao.createAgent({ type: 'senior' });
    expect(agent.team_id).toBeNull();
  });

  // --- Agent: create with all optional fields ---
  it('edge-cases.sqlite-dao case 4', async () => {
    const agent = await agentDao.createAgent({
      type: 'intermediate',
      teamId,
      tmuxSession: 'tmux-sess',
      model: 'claude-opus-4-6',
      worktreePath: '/tmp/worktree',
    });
    expect(agent.model).toBe('claude-opus-4-6');
    expect(agent.worktree_path).toBe('/tmp/worktree');
    expect(agent.tmux_session).toBe('tmux-sess');
  });

  // --- Agent: updateAgent with empty input ---
  it('edge-cases.sqlite-dao case 5', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const unchanged = await agentDao.updateAgent(agent.id, {});
    expect(unchanged!.status).toBe(agent.status);
  });

  // --- Agent: update memoryState and worktreePath ---
  it('edge-cases.sqlite-dao case 6', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const updated = await agentDao.updateAgent(agent.id, {
      memoryState: '{"context":"some state"}',
      worktreePath: '/new/path',
    });
    expect(updated!.memory_state).toBe('{"context":"some state"}');
    expect(updated!.worktree_path).toBe('/new/path');
  });

  // --- Agent: getAgentsByType returns empty ---
  it('edge-cases.sqlite-dao case 7', async () => {
    expect(await agentDao.getAgentsByType('qa')).toEqual([]);
  });

  // --- Agent: getAgentsByStatus returns empty ---
  it('edge-cases.sqlite-dao case 8', async () => {
    await agentDao.createAgent({ type: 'senior', teamId });
    expect(await agentDao.getAgentsByStatus('blocked')).toEqual([]);
  });

  // --- Agent: creating duplicate tech_lead throws ---
  it('edge-cases.sqlite-dao case 9', async () => {
    await agentDao.createAgent({ type: 'tech_lead', teamId });
    await expect(agentDao.createAgent({ type: 'tech_lead', teamId })).rejects.toThrow();
  });

  // --- Agent: getAllAgents verifies ordering by type then team_id ---
  it('edge-cases.sqlite-dao case 10', async () => {
    const t2 = await teamDao.createTeam({ repoUrl: 'u2', repoPath: '/p2', name: 'Team2' });
    await agentDao.createAgent({ type: 'senior', teamId: t2.id });
    await agentDao.createAgent({ type: 'junior', teamId });
    await agentDao.createAgent({ type: 'junior', teamId: t2.id });
    await agentDao.createAgent({ type: 'senior', teamId });

    const all = await agentDao.getAllAgents();
    expect(all).toHaveLength(4);
    // junior < senior alphabetically
    expect(all[0].type).toBe('junior');
    expect(all[1].type).toBe('junior');
    expect(all[2].type).toBe('senior');
    expect(all[3].type).toBe('senior');
  });

  // --- Story: create with null acceptanceCriteria ---
  it('edge-cases.sqlite-dao case 11', async () => {
    const story = await storyDao.createStory({ title: 'S', description: 'D' });
    expect(story.acceptance_criteria).toBeNull();
  });

  // --- Story: update acceptanceCriteria serialization ---
  it('edge-cases.sqlite-dao case 12', async () => {
    const story = await storyDao.createStory({ title: 'S', description: 'D' });
    const updated = await storyDao.updateStory(story.id, {
      acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
    });
    expect(JSON.parse(updated!.acceptance_criteria!)).toEqual(['AC1', 'AC2', 'AC3']);
  });

  // --- Story: update branchName and prUrl ---
  it('edge-cases.sqlite-dao case 13', async () => {
    const story = await storyDao.createStory({ title: 'S', description: 'D' });
    const updated = await storyDao.updateStory(story.id, {
      branchName: 'feature/xyz',
      prUrl: 'https://github.com/repo/pull/1',
    });
    expect(updated!.branch_name).toBe('feature/xyz');
    expect(updated!.pr_url).toBe('https://github.com/repo/pull/1');
  });

  // --- Story: updateStory with empty input ---
  it('edge-cases.sqlite-dao case 14', async () => {
    const story = await storyDao.createStory({ title: 'S', description: 'D' });
    const unchanged = await storyDao.updateStory(story.id, {});
    expect(unchanged!.title).toBe('S');
  });

  // --- Story: addStoryDependency is idempotent (INSERT OR IGNORE) ---
  it('edge-cases.sqlite-dao case 15', async () => {
    const s1 = await storyDao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await storyDao.createStory({ title: 'S2', description: 'D2' });

    await storyDao.addStoryDependency(s2.id, s1.id);
    await storyDao.addStoryDependency(s2.id, s1.id); // no-op, no error

    const deps = await storyDao.getStoryDependencies(s2.id);
    expect(deps).toHaveLength(1);
  });

  // --- Story: getActiveStoriesByAgent returns empty when all merged ---
  it('edge-cases.sqlite-dao case 16', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const s1 = await storyDao.createStory({ title: 'S1', description: 'D1' });
    await storyDao.updateStory(s1.id, { assignedAgentId: agent.id, status: 'merged' });

    expect(await storyDao.getActiveStoriesByAgent(agent.id)).toEqual([]);
  });

  // --- Story: getPlannedStories returns empty ---
  it('edge-cases.sqlite-dao case 17', async () => {
    await storyDao.createStory({ title: 'S1', description: 'D1' }); // status = draft
    expect(await storyDao.getPlannedStories()).toEqual([]);
  });

  // --- Story: getInProgressStories includes qa and qa_failed ---
  it('edge-cases.sqlite-dao case 18', async () => {
    const s1 = await storyDao.createStory({ title: 'S1', description: 'D1' });
    const s2 = await storyDao.createStory({ title: 'S2', description: 'D2' });
    await storyDao.updateStory(s1.id, { status: 'qa' });
    await storyDao.updateStory(s2.id, { status: 'qa_failed' });

    const inProg = await storyDao.getInProgressStories();
    expect(inProg).toHaveLength(2);
    const statuses = inProg.map(s => s.status);
    expect(statuses).toContain('qa');
    expect(statuses).toContain('qa_failed');
  });

  // --- Requirement: getAllRequirements empty initially ---
  it('edge-cases.sqlite-dao case 19', async () => {
    expect(await reqDao.getAllRequirements()).toEqual([]);
  });

  // --- PR: getMergeQueue includes reviewing status ---
  it('edge-cases.sqlite-dao case 20', async () => {
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });
    await prDao.updatePullRequest(pr2.id, { status: 'reviewing' });

    const queue = await prDao.getMergeQueue(teamId);
    expect(queue).toHaveLength(2);
    expect(queue.map(p => p.id)).toContain(pr1.id);
    expect(queue.map(p => p.id)).toContain(pr2.id);
  });

  // --- PR: getNextInQueue skips reviewing, returns only queued ---
  it('edge-cases.sqlite-dao case 21', async () => {
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId });
    db.run('UPDATE pull_requests SET created_at = ? WHERE id = ?', ['2025-01-01T00:00:00.000Z', pr1.id]);
    await prDao.updatePullRequest(pr1.id, { status: 'reviewing' });

    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });

    const next = await prDao.getNextInQueue(teamId);
    expect(next!.id).toBe(pr2.id);
  });

  // --- PR: updatePullRequest with githubPrNumber and githubPrUrl ---
  it('edge-cases.sqlite-dao case 22', async () => {
    const pr = await prDao.createPullRequest({ branchName: 'b1', teamId });
    const updated = await prDao.updatePullRequest(pr.id, {
      githubPrNumber: 99,
      githubPrUrl: 'https://github.com/org/repo/pull/99',
    });
    expect(updated!.github_pr_number).toBe(99);
    expect(updated!.github_pr_url).toBe('https://github.com/org/repo/pull/99');
  });

  // --- PR: reviewed_at auto-set for all review statuses ---
  it('edge-cases.sqlite-dao case 23', async () => {
    for (const status of ['reviewing', 'approved', 'rejected', 'merged'] as const) {
      const pr = await prDao.createPullRequest({ branchName: `b-${status}`, teamId });
      expect(pr.reviewed_at).toBeNull();

      const updated = await prDao.updatePullRequest(pr.id, { status });
      expect(updated!.reviewed_at).not.toBeNull();
    }
  });

  // --- PR: getQueuePosition for reviewing PR ---
  it('edge-cases.sqlite-dao case 24', async () => {
    await prDao.createPullRequest({ branchName: 'b1', teamId });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId });
    await prDao.updatePullRequest(pr2.id, { status: 'reviewing' });

    // reviewing is still in the merge queue
    expect(await prDao.getQueuePosition(pr2.id)).toBe(2);
  });

  // --- Escalation: reassign toAgentId via update ---
  it('edge-cases.sqlite-dao case 23', async () => {
    const agent1 = await agentDao.createAgent({ type: 'senior', teamId });
    const agent2 = await agentDao.createAgent({ type: 'tech_lead', teamId });
    const esc = await escDao.createEscalation({
      fromAgentId: agent1.id,
      toAgentId: agent1.id,
      reason: 'Self-escalation',
    });

    const updated = await escDao.updateEscalation(esc.id, { toAgentId: agent2.id });
    expect(updated!.to_agent_id).toBe(agent2.id);
  });

  // --- Escalation: resolve already-acknowledged escalation ---
  it('edge-cases.sqlite-dao case 24', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const esc = await escDao.createEscalation({ fromAgentId: agent.id, reason: 'Help' });
    await escDao.acknowledgeEscalation(esc.id);

    const resolved = await escDao.resolveEscalation(esc.id, 'Done');
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolution).toBe('Done');
    expect(resolved!.resolved_at).not.toBeNull();
  });

  // --- Log: createLog with status field ---
  it('edge-cases.sqlite-dao case 25', async () => {
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    const log = await logDao.createLog({
      agentId: agent.id,
      eventType: 'BUILD_PASSED',
      status: 'success',
      message: 'Build completed',
    });
    expect(log.status).toBe('success');
  });

  // --- Log: getLogsByAgent returns empty for unknown agent ---
  it('edge-cases.sqlite-dao case 26', async () => {
    expect(await logDao.getLogsByAgent('agent-nonexistent')).toEqual([]);
  });

  // --- Message: markMessageRead on non-existent message is a no-op ---
  it('edge-cases.sqlite-dao case 27', async () => {
    await msgDao.markMessageRead('msg-does-not-exist');
    // no throw, no side effects
    expect(await msgDao.getAllPendingMessages()).toEqual([]);
  });

  // --- Message: messages ordered by created_at ASC ---
  it('edge-cases.sqlite-dao case 28', async () => {
    run(db, `INSERT INTO messages (id, from_session, to_session, body, status, created_at)
             VALUES (?, ?, ?, ?, 'pending', ?)`, ['m1', 'a', 'b', 'First', '2025-01-02T00:00:00.000Z']);
    run(db, `INSERT INTO messages (id, from_session, to_session, body, status, created_at)
             VALUES (?, ?, ?, ?, 'pending', ?)`, ['m2', 'a', 'b', 'Second', '2025-01-01T00:00:00.000Z']);

    const msgs = await msgDao.getUnreadMessages('b');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('m2'); // earlier created_at first
    expect(msgs[1].id).toBe('m1');
  });
});
