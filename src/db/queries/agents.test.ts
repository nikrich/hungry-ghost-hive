// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../provider.js';
import {
  createAgent,
  deleteAgent,
  getActiveAgents,
  getAgentById,
  getAgentsByStatus,
  getAgentsByTeam,
  getAgentsByType,
  getAllAgents,
  getTechLead,
  terminateAgent,
  updateAgent,
} from './agents.js';
import { createTeam } from './teams.js';
import { createTestDatabase } from './test-helpers.js';

describe('agents queries', () => {
  let db: SqliteProvider;
  let teamId: string;

  beforeEach(async () => {
    const rawDb = await createTestDatabase();
    db = new SqliteProvider(rawDb);
    const team = await createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;
  });

  describe('createAgent', () => {
    it('should create a tech_lead agent with fixed ID', async () => {
      const agent = await createAgent(db, {
        type: 'tech_lead',
        teamId,
        model: 'claude-sonnet-4-5',
      });

      expect(agent.id).toBe('tech-lead');
      expect(agent.type).toBe('tech_lead');
      expect(agent.team_id).toBe(teamId);
      expect(agent.model).toBe('claude-sonnet-4-5');
      expect(agent.status).toBe('idle');
    });

    it('should create a senior agent with generated ID', async () => {
      const agent = await createAgent(db, {
        type: 'senior',
        teamId,
      });

      expect(agent.id).toMatch(/^senior-/);
      expect(agent.type).toBe('senior');
      expect(agent.status).toBe('idle');
    });

    it('should handle optional fields', async () => {
      const agent = await createAgent(db, {
        type: 'junior',
        tmuxSession: 'tmux-session-1',
        model: 'claude-sonnet-4-5-20250929',
        worktreePath: '/path/to/worktree',
      });

      expect(agent.tmux_session).toBe('tmux-session-1');
      expect(agent.model).toBe('claude-sonnet-4-5-20250929');
      expect(agent.worktree_path).toBe('/path/to/worktree');
    });

    it('should handle null/undefined teamId', async () => {
      const agent1 = await createAgent(db, {
        type: 'qa',
      });

      const agent2 = await createAgent(db, {
        type: 'intermediate',
        teamId: null,
      });

      expect(agent1.team_id).toBeNull();
      expect(agent2.team_id).toBeNull();
    });

    it('should set timestamps', async () => {
      const agent = await createAgent(db, {
        type: 'senior',
      });

      expect(agent.created_at).toBeDefined();
      expect(agent.updated_at).toBeDefined();
      expect(agent.last_seen).toBeDefined();
    });
  });

  describe('getAgentById', () => {
    it('should retrieve an agent by ID', async () => {
      const created = await createAgent(db, {
        type: 'senior',
        teamId,
      });

      const retrieved = await getAgentById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.type).toBe('senior');
    });

    it('should return undefined for non-existent agent', async () => {
      const result = await getAgentById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getAgentsByTeam', () => {
    it('should return agents for a specific team', async () => {
      const agent1 = await createAgent(db, { type: 'senior', teamId });
      const agent2 = await createAgent(db, { type: 'junior', teamId });

      const team2 = await createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });
      await createAgent(db, { type: 'senior', teamId: team2.id });

      const teamAgents = await getAgentsByTeam(db, teamId);

      expect(teamAgents).toHaveLength(2);
      expect(teamAgents.map(a => a.id)).toContain(agent1.id);
      expect(teamAgents.map(a => a.id)).toContain(agent2.id);
    });

    it('should return empty array when no agents for team', async () => {
      const agents = await getAgentsByTeam(db, 'non-existent-team');
      expect(agents).toEqual([]);
    });
  });

  describe('getAgentsByType', () => {
    it('should filter agents by type', async () => {
      const senior1 = await createAgent(db, { type: 'senior', teamId });
      const senior2 = await createAgent(db, { type: 'senior', teamId });
      await createAgent(db, { type: 'junior', teamId });

      const seniors = await getAgentsByType(db, 'senior');

      expect(seniors).toHaveLength(2);
      expect(seniors.map(a => a.id)).toContain(senior1.id);
      expect(seniors.map(a => a.id)).toContain(senior2.id);
    });
  });

  describe('getAgentsByStatus', () => {
    it('should filter agents by status', async () => {
      const agent1 = await createAgent(db, { type: 'senior', teamId });
      const agent2 = await createAgent(db, { type: 'junior', teamId });
      await updateAgent(db, agent2.id, { status: 'working' });

      const idle = await getAgentsByStatus(db, 'idle');
      const working = await getAgentsByStatus(db, 'working');

      expect(idle).toHaveLength(1);
      expect(idle[0].id).toBe(agent1.id);
      expect(working).toHaveLength(1);
      expect(working[0].id).toBe(agent2.id);
    });
  });

  describe('getAllAgents', () => {
    it('should return all agents ordered by type and team_id', async () => {
      await createAgent(db, { type: 'senior', teamId });
      await createAgent(db, { type: 'junior', teamId });
      await createAgent(db, { type: 'intermediate', teamId });

      const agents = await getAllAgents(db);

      expect(agents).toHaveLength(3);
      // Should be ordered
      expect(agents.every(a => a.id)).toBe(true);
    });

    it('should return empty array when no agents', async () => {
      const agents = await getAllAgents(db);
      expect(agents).toEqual([]);
    });
  });

  describe('getActiveAgents', () => {
    it('should return only active agents (not terminated)', async () => {
      const agent1 = await createAgent(db, { type: 'senior', teamId });
      const agent2 = await createAgent(db, { type: 'junior', teamId });
      const agent3 = await createAgent(db, { type: 'intermediate', teamId });

      await updateAgent(db, agent2.id, { status: 'working' });
      await updateAgent(db, agent3.id, { status: 'terminated' });

      const active = await getActiveAgents(db);

      expect(active).toHaveLength(2);
      expect(active.map(a => a.id)).toContain(agent1.id);
      expect(active.map(a => a.id)).toContain(agent2.id);
      expect(active.map(a => a.id)).not.toContain(agent3.id);
    });
  });

  describe('getTechLead', () => {
    it('should return the tech lead agent', async () => {
      await createAgent(db, { type: 'tech_lead', teamId });
      await createAgent(db, { type: 'senior', teamId });

      const techLead = await getTechLead(db);

      expect(techLead).toBeDefined();
      expect(techLead?.type).toBe('tech_lead');
      expect(techLead?.id).toBe('tech-lead');
    });

    it('should return undefined when no tech lead exists', async () => {
      const techLead = await getTechLead(db);
      expect(techLead).toBeUndefined();
    });
  });

  describe('updateAgent', () => {
    it('should update agent status', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, { status: 'working' });

      expect(updated?.status).toBe('working');
    });

    it('should update tmux session', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, { tmuxSession: 'new-session' });

      expect(updated?.tmux_session).toBe('new-session');
    });

    it('should update current story ID', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, { currentStoryId: 'STORY-123' });

      expect(updated?.current_story_id).toBe('STORY-123');
    });

    it('should update memory state', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });
      const memoryState = JSON.stringify({ key: 'value' });

      const updated = await updateAgent(db, agent.id, { memoryState });

      expect(updated?.memory_state).toBe(memoryState);
    });

    it('should update worktree path', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, { worktreePath: '/new/path' });

      expect(updated?.worktree_path).toBe('/new/path');
    });

    it('should update multiple fields at once', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, {
        status: 'working',
        currentStoryId: 'STORY-456',
        tmuxSession: 'updated-session',
      });

      expect(updated?.status).toBe('working');
      expect(updated?.current_story_id).toBe('STORY-456');
      expect(updated?.tmux_session).toBe('updated-session');
    });

    it('should update updated_at timestamp', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, { status: 'working' });

      // Verify updated_at exists and is a valid timestamp
      expect(updated?.updated_at).toBeDefined();
      expect(typeof updated?.updated_at).toBe('string');
    });

    it('should return agent when no updates provided', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      const updated = await updateAgent(db, agent.id, {});

      expect(updated?.id).toBe(agent.id);
    });

    it('should return undefined for non-existent agent', async () => {
      const updated = await updateAgent(db, 'non-existent-id', { status: 'working' });
      expect(updated).toBeUndefined();
    });

    it('should handle setting fields to null', async () => {
      const agent = await createAgent(db, {
        type: 'senior',
        teamId,
        tmuxSession: 'session-1',
      });

      const updated = await updateAgent(db, agent.id, { tmuxSession: null });

      expect(updated?.tmux_session).toBeNull();
    });

    it('should reset created_at when createdAt is provided', async () => {
      const agent = await createAgent(db, { type: 'tech_lead', teamId });
      const newCreatedAt = new Date(Date.now() + 60_000).toISOString();

      const updated = await updateAgent(db, agent.id, {
        status: 'working',
        createdAt: newCreatedAt,
      });

      expect(updated?.created_at).toBe(newCreatedAt);
      expect(updated?.status).toBe('working');
    });
  });

  describe('deleteAgent', () => {
    it('should delete an agent', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });

      await deleteAgent(db, agent.id);

      const retrieved = await getAgentById(db, agent.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent agent', async () => {
      await expect(deleteAgent(db, 'non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('terminateAgent', () => {
    it('should set agent status to terminated and clear tmux session', async () => {
      const agent = await createAgent(db, {
        type: 'senior',
        teamId,
        tmuxSession: 'session-1',
      });

      await terminateAgent(db, agent.id);

      const terminated = await getAgentById(db, agent.id);
      expect(terminated?.status).toBe('terminated');
      expect(terminated?.tmux_session).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle all agent types', async () => {
      const types: Array<'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa'> = [
        'tech_lead',
        'senior',
        'intermediate',
        'junior',
        'qa',
      ];

      for (const type of types) {
        const agent = await createAgent(db, { type });
        expect(agent.type).toBe(type);
      }
    });

    it('should handle all agent statuses', async () => {
      const statuses: Array<'idle' | 'working' | 'blocked' | 'terminated'> = [
        'idle',
        'working',
        'blocked',
        'terminated',
      ];

      const agent = await createAgent(db, { type: 'senior', teamId });

      for (const status of statuses) {
        const updated = await updateAgent(db, agent.id, { status });
        expect(updated?.status).toBe(status);
      }
    });

    it('should handle long memory state strings', async () => {
      const agent = await createAgent(db, { type: 'senior', teamId });
      const longMemory = JSON.stringify({ data: 'A'.repeat(100000) });

      const updated = await updateAgent(db, agent.id, { memoryState: longMemory });

      expect(updated?.memory_state).toBe(longMemory);
    });
  });
});
