import type { Level } from 'level';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageRow } from '../../queries/messages.js';
import { LevelDbAgentDao } from '../leveldb/agent.leveldb-dao.js';
import { LevelDbEscalationDao } from '../leveldb/escalation.leveldb-dao.js';
import { LevelDbStore } from '../leveldb/leveldb-store.js';
import { LevelDbLogDao } from '../leveldb/log.leveldb-dao.js';
import { LevelDbMessageDao } from '../leveldb/message.leveldb-dao.js';
import { LevelDbPullRequestDao } from '../leveldb/pull-request.leveldb-dao.js';
import { LevelDbRequirementDao } from '../leveldb/requirement.leveldb-dao.js';
import { LevelDbStoryDao } from '../leveldb/story.leveldb-dao.js';
import { LevelDbTeamDao } from '../leveldb/team.leveldb-dao.js';
import { createTestLevelDb } from './leveldb-helpers.js';

describe('LevelDb DAO integration', () => {
  let db: Level<string, unknown>;
  let cleanup: () => Promise<void>;
  let store: LevelDbStore;
  let nowCounter: number;
  let now: () => string;
  let teamDao: LevelDbTeamDao;
  let agentDao: LevelDbAgentDao;
  let storyDao: LevelDbStoryDao;
  let reqDao: LevelDbRequirementDao;
  let prDao: LevelDbPullRequestDao;
  let escDao: LevelDbEscalationDao;
  let logDao: LevelDbLogDao;
  let msgDao: LevelDbMessageDao;

  beforeEach(async () => {
    const setup = await createTestLevelDb();
    db = setup.db;
    cleanup = setup.cleanup;
    store = new LevelDbStore(db);
    nowCounter = 0;
    const base = Date.parse('2025-01-01T00:00:00.000Z');
    now = () => new Date(base + nowCounter++ * 1000).toISOString();

    teamDao = new LevelDbTeamDao(store, now);
    agentDao = new LevelDbAgentDao(store, now);
    storyDao = new LevelDbStoryDao(store, now);
    reqDao = new LevelDbRequirementDao(store, now);
    prDao = new LevelDbPullRequestDao(store, now);
    escDao = new LevelDbEscalationDao(store, now);
    logDao = new LevelDbLogDao(store, now);
    msgDao = new LevelDbMessageDao(store);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('leveldb-dao case 1', async () => {
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await agentDao.createAgent({ type: 'senior', teamId: team.id });

    const foundTeam = await teamDao.getTeamById(team.id);
    const teamAgents = await agentDao.getAgentsByTeam(team.id);

    expect(foundTeam).toEqual(team);
    expect(teamAgents).toHaveLength(1);
    expect(teamAgents[0].id).toBe(agent.id);
  });

  it('leveldb-dao case 2', async () => {
    const r1 = await reqDao.createRequirement({ title: 'First', description: 'Desc' });
    const r2 = await reqDao.createRequirement({ title: 'Second', description: 'Desc' });

    const all = await reqDao.getAllRequirements();
    expect(all[0].id).toBe(r2.id);
    expect(all[1].id).toBe(r1.id);

    await reqDao.updateRequirement(r1.id, { status: 'planned' });
    const planned = await reqDao.getRequirementsByStatus('planned');
    expect(planned).toHaveLength(1);
    expect(planned[0].id).toBe(r1.id);
  });

  it('leveldb-dao case 3', async () => {
    const r1 = await reqDao.createRequirement({ title: 'Old', description: 'Desc' });
    const r2 = await reqDao.createRequirement({ title: 'New', description: 'Desc' });

    const pending = await reqDao.getPendingRequirements();
    expect(pending.map(req => req.id)).toEqual([r1.id, r2.id]);
  });

  it('leveldb-dao case 4', async () => {
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await agentDao.createAgent({ type: 'senior', teamId: team.id });

    const s1 = await storyDao.createStory({ title: 'S1', description: 'D1', teamId: team.id });
    const s2 = await storyDao.createStory({ title: 'S2', description: 'D2', teamId: team.id });

    await storyDao.addStoryDependency(s2.id, s1.id);
    const deps = await storyDao.getStoryDependencies(s2.id);
    expect(deps).toHaveLength(1);

    await storyDao.updateStory(s2.id, { assignedAgentId: agent.id });
    await agentDao.terminateAgent(agent.id);
    const orphaned = await storyDao.getStoriesWithOrphanedAssignments();
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].id).toBe(s2.id);
  });

  it('leveldb-dao case 5', async () => {
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const pr1 = await prDao.createPullRequest({ branchName: 'b1', teamId: team.id });
    const pr2 = await prDao.createPullRequest({ branchName: 'b2', teamId: team.id });
    await prDao.updatePullRequest(pr2.id, { status: 'reviewing' });

    const queue = await prDao.getMergeQueue(team.id);
    expect(queue.map(pr => pr.id)).toEqual([pr1.id, pr2.id]);
    expect(await prDao.getQueuePosition(pr2.id)).toBe(2);
  });

  it('leveldb-dao case 6', async () => {
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await agentDao.createAgent({ type: 'senior', teamId: team.id });
    const story = await storyDao.createStory({ title: 'S', description: 'D', teamId: team.id });

    const esc = await escDao.createEscalation({
      storyId: story.id,
      fromAgentId: agent.id,
      reason: 'Need help',
    });

    const pending = await escDao.getPendingHumanEscalations();
    expect(pending).toHaveLength(1);

    await escDao.resolveEscalation(esc.id, 'Done');
    const resolved = await escDao.getEscalationById(esc.id);
    expect(resolved!.status).toBe('resolved');
  });

  it('leveldb-dao case 7', async () => {
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await agentDao.createAgent({ type: 'senior', teamId: team.id });

    const log1 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_SPAWNED' });
    const log2 = await logDao.createLog({ agentId: agent.id, eventType: 'AGENT_CHECKPOINT' });

    const recent = await logDao.getRecentLogs();
    expect(recent[0].id).toBe(log2.id);
    expect(recent[1].id).toBe(log1.id);
  });

  it('leveldb-dao case 8', async () => {
    const message1: MessageRow = {
      id: 'm1',
      from_session: 'a',
      to_session: 'b',
      subject: null,
      body: 'Hello',
      reply: null,
      status: 'pending',
      created_at: now(),
      replied_at: null,
    };
    const message2: MessageRow = {
      id: 'm2',
      from_session: 'a',
      to_session: 'b',
      subject: null,
      body: 'World',
      reply: null,
      status: 'pending',
      created_at: now(),
      replied_at: null,
    };

    await store.put('message:m1', message1);
    await store.put('message:m2', message2);

    const unread = await msgDao.getUnreadMessages('b');
    expect(unread).toHaveLength(2);

    await msgDao.markMessageRead('m1');
    const pending = await msgDao.getAllPendingMessages();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('m2');
  });
});
