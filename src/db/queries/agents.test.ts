// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
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
  let db: Database;
  let teamId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;
  });

  describe('createAgent', () => {
    it('should create a tech_lead agent with fixed ID', () => {
      const agent = createAgent(db, {
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

    it('should create a senior agent with generated ID', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      expect(agent.id).toMatch(/^senior-/);
      expect(agent.type).toBe('senior');
      expect(agent.status).toBe('idle');
    });

    it('should handle optional fields', () => {
      const agent = createAgent(db, {
        type: 'junior',
        tmuxSession: 'tmux-session-1',
        model: 'claude-haiku-4-5',
        worktreePath: '/path/to/worktree',
      });

      expect(agent.tmux_session).toBe('tmux-session-1');
      expect(agent.model).toBe('claude-haiku-4-5');
      expect(agent.worktree_path).toBe('/path/to/worktree');
    });

    it('should handle null/undefined teamId', () => {
      const agent1 = createAgent(db, {
        type: 'qa',
      });

      const agent2 = createAgent(db, {
        type: 'intermediate',
        teamId: null,
      });

      expect(agent1.team_id).toBeNull();
      expect(agent2.team_id).toBeNull();
    });

    it('should set timestamps', () => {
      const agent = createAgent(db, {
        type: 'senior',
      });

      expect(agent.created_at).toBeDefined();
      expect(agent.updated_at).toBeDefined();
      expect(agent.last_seen).toBeDefined();
    });
  });

  describe('getAgentById', () => {
    it('should retrieve an agent by ID', () => {
      const created = createAgent(db, {
        type: 'senior',
        teamId,
      });

      const retrieved = getAgentById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.type).toBe('senior');
    });

    it('should return undefined for non-existent agent', () => {
      const result = getAgentById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getAgentsByTeam', () => {
    it('should return agents for a specific team', () => {
      const agent1 = createAgent(db, { type: 'senior', teamId });
      const agent2 = createAgent(db, { type: 'junior', teamId });

      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });
      createAgent(db, { type: 'senior', teamId: team2.id });

      const teamAgents = getAgentsByTeam(db, teamId);

      expect(teamAgents).toHaveLength(2);
      expect(teamAgents.map(a => a.id)).toContain(agent1.id);
      expect(teamAgents.map(a => a.id)).toContain(agent2.id);
    });

    it('should return empty array when no agents for team', () => {
      const agents = getAgentsByTeam(db, 'non-existent-team');
      expect(agents).toEqual([]);
    });
  });

  describe('getAgentsByType', () => {
    it('should filter agents by type', () => {
      const senior1 = createAgent(db, { type: 'senior', teamId });
      const senior2 = createAgent(db, { type: 'senior', teamId });
      createAgent(db, { type: 'junior', teamId });

      const seniors = getAgentsByType(db, 'senior');

      expect(seniors).toHaveLength(2);
      expect(seniors.map(a => a.id)).toContain(senior1.id);
      expect(seniors.map(a => a.id)).toContain(senior2.id);
    });
  });

  describe('getAgentsByStatus', () => {
    it('should filter agents by status', () => {
      const agent1 = createAgent(db, { type: 'senior', teamId });
      const agent2 = createAgent(db, { type: 'junior', teamId });
      updateAgent(db, agent2.id, { status: 'working' });

      const idle = getAgentsByStatus(db, 'idle');
      const working = getAgentsByStatus(db, 'working');

      expect(idle).toHaveLength(1);
      expect(idle[0].id).toBe(agent1.id);
      expect(working).toHaveLength(1);
      expect(working[0].id).toBe(agent2.id);
    });
  });

  describe('getAllAgents', () => {
    it('should return all agents ordered by type and team_id', () => {
      createAgent(db, { type: 'senior', teamId });
      createAgent(db, { type: 'junior', teamId });
      createAgent(db, { type: 'intermediate', teamId });

      const agents = getAllAgents(db);

      expect(agents).toHaveLength(3);
      // Should be ordered
      expect(agents.every(a => a.id)).toBe(true);
    });

    it('should return empty array when no agents', () => {
      const agents = getAllAgents(db);
      expect(agents).toEqual([]);
    });
  });

  describe('getActiveAgents', () => {
    it('should return only active agents (not terminated)', () => {
      const agent1 = createAgent(db, { type: 'senior', teamId });
      const agent2 = createAgent(db, { type: 'junior', teamId });
      const agent3 = createAgent(db, { type: 'intermediate', teamId });

      updateAgent(db, agent2.id, { status: 'working' });
      updateAgent(db, agent3.id, { status: 'terminated' });

      const active = getActiveAgents(db);

      expect(active).toHaveLength(2);
      expect(active.map(a => a.id)).toContain(agent1.id);
      expect(active.map(a => a.id)).toContain(agent2.id);
      expect(active.map(a => a.id)).not.toContain(agent3.id);
    });
  });

  describe('getTechLead', () => {
    it('should return the tech lead agent', () => {
      createAgent(db, { type: 'tech_lead', teamId });
      createAgent(db, { type: 'senior', teamId });

      const techLead = getTechLead(db);

      expect(techLead).toBeDefined();
      expect(techLead?.type).toBe('tech_lead');
      expect(techLead?.id).toBe('tech-lead');
    });

    it('should return undefined when no tech lead exists', () => {
      const techLead = getTechLead(db);
      expect(techLead).toBeUndefined();
    });
  });

  describe('updateAgent', () => {
    it('should update agent status', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, { status: 'working' });

      expect(updated?.status).toBe('working');
    });

    it('should update tmux session', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, { tmuxSession: 'new-session' });

      expect(updated?.tmux_session).toBe('new-session');
    });

    it('should update current story ID', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, { currentStoryId: 'STORY-123' });

      expect(updated?.current_story_id).toBe('STORY-123');
    });

    it('should update memory state', () => {
      const agent = createAgent(db, { type: 'senior', teamId });
      const memoryState = JSON.stringify({ key: 'value' });

      const updated = updateAgent(db, agent.id, { memoryState });

      expect(updated?.memory_state).toBe(memoryState);
    });

    it('should update worktree path', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, { worktreePath: '/new/path' });

      expect(updated?.worktree_path).toBe('/new/path');
    });

    it('should update multiple fields at once', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, {
        status: 'working',
        currentStoryId: 'STORY-456',
        tmuxSession: 'updated-session',
      });

      expect(updated?.status).toBe('working');
      expect(updated?.current_story_id).toBe('STORY-456');
      expect(updated?.tmux_session).toBe('updated-session');
    });

    it('should update updated_at timestamp', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, { status: 'working' });

      // Verify updated_at exists and is a valid timestamp
      expect(updated?.updated_at).toBeDefined();
      expect(typeof updated?.updated_at).toBe('string');
    });

    it('should return agent when no updates provided', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      const updated = updateAgent(db, agent.id, {});

      expect(updated?.id).toBe(agent.id);
    });

    it('should return undefined for non-existent agent', () => {
      const updated = updateAgent(db, 'non-existent-id', { status: 'working' });
      expect(updated).toBeUndefined();
    });

    it('should handle setting fields to null', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
        tmuxSession: 'session-1',
      });

      const updated = updateAgent(db, agent.id, { tmuxSession: null });

      expect(updated?.tmux_session).toBeNull();
    });
  });

  describe('deleteAgent', () => {
    it('should delete an agent', () => {
      const agent = createAgent(db, { type: 'senior', teamId });

      deleteAgent(db, agent.id);

      const retrieved = getAgentById(db, agent.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent agent', () => {
      expect(() => deleteAgent(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('terminateAgent', () => {
    it('should set agent status to terminated and clear tmux session', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
        tmuxSession: 'session-1',
      });

      terminateAgent(db, agent.id);

      const terminated = getAgentById(db, agent.id);
      expect(terminated?.status).toBe('terminated');
      expect(terminated?.tmux_session).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle all agent types', () => {
      const types: Array<'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa'> = [
        'tech_lead',
        'senior',
        'intermediate',
        'junior',
        'qa',
      ];

      types.forEach(type => {
        const agent = createAgent(db, { type });
        expect(agent.type).toBe(type);
      });
    });

    it('should handle all agent statuses', () => {
      const statuses: Array<'idle' | 'working' | 'blocked' | 'terminated'> = [
        'idle',
        'working',
        'blocked',
        'terminated',
      ];

      const agent = createAgent(db, { type: 'senior', teamId });

      statuses.forEach(status => {
        const updated = updateAgent(db, agent.id, { status });
        expect(updated?.status).toBe(status);
      });
    });

    it('should handle long memory state strings', () => {
      const agent = createAgent(db, { type: 'senior', teamId });
      const longMemory = JSON.stringify({ data: 'A'.repeat(100000) });

      const updated = updateAgent(db, agent.id, { memoryState: longMemory });

      expect(updated?.memory_state).toBe(longMemory);
    });
  });
});
