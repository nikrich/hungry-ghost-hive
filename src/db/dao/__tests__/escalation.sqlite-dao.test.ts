import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteEscalationDao } from '../sqlite/escalation.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('SqliteEscalationDao', () => {
  let db: Database;
  let dao: SqliteEscalationDao;
  let teamDao: SqliteTeamDao;
  let agentDao: SqliteAgentDao;
  let storyDao: SqliteStoryDao;
  let teamId: string;
  let agentId: string;
  let storyId: string;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteEscalationDao(db);
    teamDao = new SqliteTeamDao(db);
    agentDao = new SqliteAgentDao(db);
    storyDao = new SqliteStoryDao(db);

    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    teamId = team.id;
    const agent = await agentDao.createAgent({ type: 'senior', teamId });
    agentId = agent.id;
    const story = await storyDao.createStory({ title: 'Story', description: 'Desc', teamId });
    storyId = story.id;
  });

  afterEach(() => {
    db.close();
  });

  it('escalation.sqlite-dao case 1', async () => {
    const esc = await dao.createEscalation({
      storyId,
      fromAgentId: agentId,
      reason: 'Blocked on dependency',
    });

    expect(esc.id).toMatch(/^ESC-/);
    expect(esc.story_id).toBe(storyId);
    expect(esc.from_agent_id).toBe(agentId);
    expect(esc.reason).toBe('Blocked on dependency');
    expect(esc.status).toBe('pending');
  });

  it('escalation.sqlite-dao case 2', async () => {
    const esc = await dao.createEscalation({
      storyId,
      fromAgentId: agentId,
      reason: 'Need human input',
    });

    expect(esc.to_agent_id).toBeNull();
  });

  it('escalation.sqlite-dao case 3', async () => {
    const agent2 = await agentDao.createAgent({ type: 'tech_lead', teamId });
    const esc = await dao.createEscalation({
      storyId,
      fromAgentId: agentId,
      toAgentId: agent2.id,
      reason: 'Need TL review',
    });

    expect(esc.to_agent_id).toBe(agent2.id);
  });

  it('escalation.sqlite-dao case 4', async () => {
    const created = await dao.createEscalation({ reason: 'Test', fromAgentId: agentId });
    const found = await dao.getEscalationById(created.id);
    expect(found).toEqual(created);
  });

  it('escalation.sqlite-dao case 5', async () => {
    expect(await dao.getEscalationById('ESC-NOPE')).toBeUndefined();
  });

  it('escalation.sqlite-dao case 6', async () => {
    await dao.createEscalation({ storyId, fromAgentId: agentId, reason: 'R1' });
    await dao.createEscalation({ storyId, fromAgentId: agentId, reason: 'R2' });
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R3' }); // no story

    const byStory = await dao.getEscalationsByStory(storyId);
    expect(byStory).toHaveLength(2);
  });

  it('escalation.sqlite-dao case 7', async () => {
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R1' });
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R2' });

    const byAgent = await dao.getEscalationsByFromAgent(agentId);
    expect(byAgent).toHaveLength(2);
  });

  it('escalation.sqlite-dao case 8', async () => {
    await dao.createEscalation({ fromAgentId: agentId, reason: 'Human esc' });

    const humanEsc = await dao.getEscalationsByToAgent(null);
    expect(humanEsc).toHaveLength(1);
  });

  it('escalation.sqlite-dao case 9', async () => {
    const agent2 = await agentDao.createAgent({ type: 'tech_lead', teamId });
    await dao.createEscalation({ fromAgentId: agentId, toAgentId: agent2.id, reason: 'TL esc' });

    const tlEsc = await dao.getEscalationsByToAgent(agent2.id);
    expect(tlEsc).toHaveLength(1);
  });

  it('escalation.sqlite-dao case 10', async () => {
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R1' });
    const e2 = await dao.createEscalation({ fromAgentId: agentId, reason: 'R2' });
    await dao.acknowledgeEscalation(e2.id);

    const pending = await dao.getEscalationsByStatus('pending');
    expect(pending).toHaveLength(1);

    const acked = await dao.getEscalationsByStatus('acknowledged');
    expect(acked).toHaveLength(1);
  });

  it('escalation.sqlite-dao case 11', async () => {
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R1' });
    const e2 = await dao.createEscalation({ fromAgentId: agentId, reason: 'R2' });
    await dao.resolveEscalation(e2.id, 'Fixed');

    const pending = await dao.getPendingEscalations();
    expect(pending).toHaveLength(1);
  });

  it('escalation.sqlite-dao case 12', async () => {
    await dao.createEscalation({ fromAgentId: agentId, reason: 'Human esc' });
    const agent2 = await agentDao.createAgent({ type: 'tech_lead', teamId });
    await dao.createEscalation({ fromAgentId: agentId, toAgentId: agent2.id, reason: 'Agent esc' });

    const humanEsc = await dao.getPendingHumanEscalations();
    expect(humanEsc).toHaveLength(1);
    expect(humanEsc[0].to_agent_id).toBeNull();
  });

  it('escalation.sqlite-dao case 13', async () => {
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R1' });
    await dao.createEscalation({ fromAgentId: agentId, reason: 'R2' });

    const all = await dao.getAllEscalations();
    expect(all).toHaveLength(2);
  });

  it('escalation.sqlite-dao case 14', async () => {
    const esc = await dao.createEscalation({ fromAgentId: agentId, reason: 'Test' });
    const updated = await dao.updateEscalation(esc.id, {
      status: 'acknowledged',
    });

    expect(updated!.status).toBe('acknowledged');
  });

  it('escalation.sqlite-dao case 15', async () => {
    const esc = await dao.createEscalation({ fromAgentId: agentId, reason: 'Test' });
    const unchanged = await dao.updateEscalation(esc.id, {});
    expect(unchanged).toEqual(esc);
  });

  it('escalation.sqlite-dao case 16', async () => {
    const esc = await dao.createEscalation({ fromAgentId: agentId, reason: 'Test' });
    expect(esc.resolved_at).toBeNull();

    const resolved = await dao.resolveEscalation(esc.id, 'Fixed the issue');
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolution).toBe('Fixed the issue');
    expect(resolved!.resolved_at).toBeDefined();
    expect(resolved!.resolved_at).not.toBeNull();
  });

  it('escalation.sqlite-dao case 17', async () => {
    const esc = await dao.createEscalation({ fromAgentId: agentId, reason: 'Test' });
    const acked = await dao.acknowledgeEscalation(esc.id);

    expect(acked!.status).toBe('acknowledged');
  });

  it('escalation.sqlite-dao case 18', async () => {
    const esc = await dao.createEscalation({ fromAgentId: agentId, reason: 'Delete me' });
    await dao.deleteEscalation(esc.id);
    expect(await dao.getEscalationById(esc.id)).toBeUndefined();
  });
});
