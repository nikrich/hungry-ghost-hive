import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteLogDao } from '../sqlite/log.sqlite-dao.js';
import { SqliteStoryDao } from '../sqlite/story.sqlite-dao.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('SqliteLogDao', () => {
  let db: Database;
  let dao: SqliteLogDao;
  let agentId: string;
  let storyId: string;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteLogDao(db);

    const teamDao = new SqliteTeamDao(db);
    const agentDao = new SqliteAgentDao(db);
    const storyDao = new SqliteStoryDao(db);

    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    const agent = await agentDao.createAgent({ type: 'senior', teamId: team.id });
    agentId = agent.id;
    const story = await storyDao.createStory({
      title: 'Story',
      description: 'Desc',
      teamId: team.id,
    });
    storyId = story.id;
  });

  afterEach(() => {
    db.close();
  });

  it('log.sqlite-dao case 1', async () => {
    const log = await dao.createLog({
      agentId,
      eventType: 'AGENT_SPAWNED',
      message: 'Agent started',
    });

    expect(log.id).toBeGreaterThan(0);
    expect(log.agent_id).toBe(agentId);
    expect(log.event_type).toBe('AGENT_SPAWNED');
    expect(log.message).toBe('Agent started');
    expect(log.timestamp).toBeDefined();
  });

  it('log.sqlite-dao case 2', async () => {
    const log1 = await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });
    const log2 = await dao.createLog({ agentId, eventType: 'STORY_STARTED' });

    expect(log2.id).toBeGreaterThan(log1.id);
  });

  it('log.sqlite-dao case 3', async () => {
    const log = await dao.createLog({
      agentId,
      storyId,
      eventType: 'STORY_STARTED',
    });

    expect(log.story_id).toBe(storyId);
  });

  it('log.sqlite-dao case 4', async () => {
    const log = await dao.createLog({
      agentId,
      eventType: 'AGENT_CHECKPOINT',
      metadata: { progress: 50, step: 'building' },
    });

    expect(log.metadata).toBe(JSON.stringify({ progress: 50, step: 'building' }));
  });

  it('log.sqlite-dao case 5', async () => {
    const created = await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });
    const found = await dao.getLogById(created.id);
    expect(found).toEqual(created);
  });

  it('log.sqlite-dao case 6', async () => {
    expect(await dao.getLogById(99999)).toBeUndefined();
  });

  it('log.sqlite-dao case 7', async () => {
    for (let i = 0; i < 5; i++) {
      await dao.createLog({ agentId, eventType: 'AGENT_CHECKPOINT' });
    }

    const logs = await dao.getLogsByAgent(agentId);
    expect(logs).toHaveLength(5);
  });

  it('log.sqlite-dao case 8', async () => {
    for (let i = 0; i < 5; i++) {
      await dao.createLog({ agentId, eventType: 'AGENT_CHECKPOINT' });
    }

    const logs = await dao.getLogsByAgent(agentId, 2);
    expect(logs).toHaveLength(2);
  });

  it('log.sqlite-dao case 9', async () => {
    await dao.createLog({ agentId, storyId, eventType: 'STORY_STARTED' });
    await dao.createLog({ agentId, storyId, eventType: 'STORY_COMPLETED' });
    await dao.createLog({ agentId, eventType: 'AGENT_CHECKPOINT' }); // no story

    const logs = await dao.getLogsByStory(storyId);
    expect(logs).toHaveLength(2);
  });

  it('log.sqlite-dao case 10', async () => {
    await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });
    await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });
    await dao.createLog({ agentId, eventType: 'STORY_STARTED' });

    const logs = await dao.getLogsByEventType('AGENT_SPAWNED');
    expect(logs).toHaveLength(2);
  });

  it('log.sqlite-dao case 11', async () => {
    for (let i = 0; i < 3; i++) {
      await dao.createLog({ agentId, eventType: 'AGENT_CHECKPOINT' });
    }

    const logs = await dao.getRecentLogs();
    expect(logs).toHaveLength(3);
  });

  it('log.sqlite-dao case 12', async () => {
    for (let i = 0; i < 5; i++) {
      await dao.createLog({ agentId, eventType: 'AGENT_CHECKPOINT' });
    }

    const logs = await dao.getRecentLogs(2);
    expect(logs).toHaveLength(2);
  });

  it('log.sqlite-dao case 13', async () => {
    const pastDate = new Date('2020-01-01').toISOString();

    await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });
    await dao.createLog({ agentId, eventType: 'STORY_STARTED' });

    const logs = await dao.getLogsSince(pastDate);
    expect(logs).toHaveLength(2);
    // ASC order
    expect(logs[0].event_type).toBe('AGENT_SPAWNED');
  });

  it('log.sqlite-dao case 14', async () => {
    await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });

    const futureDate = new Date('2099-01-01').toISOString();
    const logs = await dao.getLogsSince(futureDate);
    expect(logs).toHaveLength(0);
  });

  it('log.sqlite-dao case 15', async () => {
    // Create logs with old timestamps manually
    db.run(
      `
      INSERT INTO agent_logs (agent_id, event_type, timestamp)
      VALUES (?, 'AGENT_SPAWNED', '2020-01-01T00:00:00.000Z')
    `,
      [agentId]
    );
    db.run(
      `
      INSERT INTO agent_logs (agent_id, event_type, timestamp)
      VALUES (?, 'AGENT_SPAWNED', '2020-01-02T00:00:00.000Z')
    `,
      [agentId]
    );

    // Create a recent log
    await dao.createLog({ agentId, eventType: 'AGENT_CHECKPOINT' });

    const pruned = await dao.pruneOldLogs(1); // 1 day retention
    expect(pruned).toBe(2);

    const remaining = await dao.getRecentLogs();
    expect(remaining).toHaveLength(1);
  });

  it('log.sqlite-dao case 16', async () => {
    await dao.createLog({ agentId, eventType: 'AGENT_SPAWNED' });

    const pruned = await dao.pruneOldLogs(1);
    expect(pruned).toBe(0);
  });
});
