import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './helpers.js';
import { SqliteAgentDao } from '../sqlite/agent.sqlite-dao.js';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';

describe('SqliteAgentDao', () => {
  let db: Database;
  let dao: SqliteAgentDao;
  let teamDao: SqliteTeamDao;
  let teamId: string;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteAgentDao(db);
    teamDao = new SqliteTeamDao(db);
    const team = await teamDao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Team' });
    teamId = team.id;
  });

  afterEach(() => {
    db.close();
  });

  it('agent.sqlite-dao case 1', async () => {
    const agent = await dao.createAgent({ type: 'senior', teamId });
    expect(agent.id).toMatch(/^senior-/);
    expect(agent.type).toBe('senior');
    expect(agent.team_id).toBe(teamId);
    expect(agent.status).toBe('idle');
  });

  it('agent.sqlite-dao case 2', async () => {
    const agent = await dao.createAgent({ type: 'tech_lead', teamId });
    expect(agent.id).toBe('tech-lead');
    expect(agent.type).toBe('tech_lead');
  });

  it('agent.sqlite-dao case 3', async () => {
    const created = await dao.createAgent({ type: 'junior', teamId });
    const found = await dao.getAgentById(created.id);
    expect(found).toEqual(created);
  });

  it('agent.sqlite-dao case 4', async () => {
    expect(await dao.getAgentById('nonexistent')).toBeUndefined();
  });

  it('agent.sqlite-dao case 5', async () => {
    await dao.createAgent({ type: 'senior', teamId });
    await dao.createAgent({ type: 'junior', teamId });

    const team2 = await teamDao.createTeam({ repoUrl: 'url2', repoPath: '/p2', name: 'Team2' });
    await dao.createAgent({ type: 'qa', teamId: team2.id });

    const agents = await dao.getAgentsByTeam(teamId);
    expect(agents).toHaveLength(2);
  });

  it('agent.sqlite-dao case 6', async () => {
    await dao.createAgent({ type: 'senior', teamId });
    await dao.createAgent({ type: 'senior', teamId });
    await dao.createAgent({ type: 'junior', teamId });

    const seniors = await dao.getAgentsByType('senior');
    expect(seniors).toHaveLength(2);
  });

  it('agent.sqlite-dao case 7', async () => {
    const agent = await dao.createAgent({ type: 'senior', teamId });
    await dao.updateAgent(agent.id, { status: 'working' });

    const working = await dao.getAgentsByStatus('working');
    expect(working).toHaveLength(1);
    expect(working[0].id).toBe(agent.id);
  });

  it('agent.sqlite-dao case 8', async () => {
    await dao.createAgent({ type: 'senior', teamId });
    await dao.createAgent({ type: 'junior', teamId });

    const all = await dao.getAllAgents();
    expect(all).toHaveLength(2);
  });

  it('agent.sqlite-dao case 9', async () => {
    const a1 = await dao.createAgent({ type: 'senior', teamId });
    await dao.createAgent({ type: 'junior', teamId });
    await dao.terminateAgent(a1.id);

    const active = await dao.getActiveAgents();
    expect(active).toHaveLength(1);
    expect(active[0].status).not.toBe('terminated');
  });

  it('agent.sqlite-dao case 10', async () => {
    await dao.createAgent({ type: 'tech_lead', teamId });
    await dao.createAgent({ type: 'senior', teamId });

    const tl = await dao.getTechLead();
    expect(tl).toBeDefined();
    expect(tl!.type).toBe('tech_lead');
  });

  it('agent.sqlite-dao case 11', async () => {
    expect(await dao.getTechLead()).toBeUndefined();
  });

  it('agent.sqlite-dao case 12', async () => {
    const agent = await dao.createAgent({ type: 'senior', teamId });
    const updated = await dao.updateAgent(agent.id, {
      status: 'working',
      tmuxSession: 'tmux-123',
      currentStoryId: 'STORY-ABC',
    });

    expect(updated!.status).toBe('working');
    expect(updated!.tmux_session).toBe('tmux-123');
    expect(updated!.current_story_id).toBe('STORY-ABC');
  });

  it('agent.sqlite-dao case 13', async () => {
    const agent = await dao.createAgent({ type: 'junior', teamId });
    await dao.deleteAgent(agent.id);
    expect(await dao.getAgentById(agent.id)).toBeUndefined();
  });

  it('agent.sqlite-dao case 14', async () => {
    const agent = await dao.createAgent({ type: 'senior', teamId, tmuxSession: 'tmux-session' });
    await dao.terminateAgent(agent.id);

    const terminated = await dao.getAgentById(agent.id);
    expect(terminated!.status).toBe('terminated');
    expect(terminated!.tmux_session).toBeNull();
  });

  describe('heartbeat', () => {
    it('agent.sqlite-dao case 14', async () => {
      const agent = await dao.createAgent({ type: 'senior', teamId });
      await dao.updateAgentHeartbeat(agent.id);

      const updated = await dao.getAgentById(agent.id);
      expect(updated!.last_seen).toBeDefined();
    });

    it('agent.sqlite-dao case 15', async () => {
      const agent = await dao.createAgent({ type: 'senior', teamId });
      // Agent just created with last_seen = now, so heartbeat should be current
      const isCurrent = await dao.isAgentHeartbeatCurrent(agent.id, 60);
      expect(isCurrent).toBe(true);
    });

    it('agent.sqlite-dao case 16', async () => {
      const isCurrent = await dao.isAgentHeartbeatCurrent('nonexistent', 15);
      expect(isCurrent).toBe(false);
    });

    it('agent.sqlite-dao case 17', async () => {
      await dao.createAgent({ type: 'senior', teamId });
      const stale = await dao.getStaleAgents(9999);
      expect(stale).toEqual([]);
    });
  });
});
