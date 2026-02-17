// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgent } from './agents.js';
import { getStaleAgents, isAgentHeartbeatCurrent, updateAgentHeartbeat } from './heartbeat.js';
import { createTeam } from './teams.js';
import { createTestDatabase } from './test-helpers.js';

describe('heartbeat queries', () => {
  let db: Database.Database;
  let teamId: string;

  beforeEach(async () => {
    db = createTestDatabase();
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;
  });

  describe('updateAgentHeartbeat', () => {
    it('should update agent last_seen timestamp', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      updateAgentHeartbeat(db, agent.id);

      const afterUpdate = db
        .prepare(`SELECT last_seen FROM agents WHERE id = ?`)
        .all(agent.id) as any[];
      const updatedLastSeen = afterUpdate[0]?.last_seen;

      expect(updatedLastSeen).toBeDefined();
      expect(typeof updatedLastSeen).toBe('string');
    });

    it('should handle multiple heartbeat updates', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      updateAgentHeartbeat(db, agent.id);
      updateAgentHeartbeat(db, agent.id);
      updateAgentHeartbeat(db, agent.id);

      const result = db.prepare(`SELECT last_seen FROM agents WHERE id = ?`).all(agent.id) as any[];
      const lastSeen = result[0]?.last_seen;

      expect(lastSeen).toBeDefined();
    });

    it('should not throw error for non-existent agent', () => {
      expect(() => {
        updateAgentHeartbeat(db, 'non-existent-agent');
      }).not.toThrow();
    });
  });

  describe('getStaleAgents', () => {
    it('should return agents with stale heartbeats', () => {
      // Create agent and manually set old last_seen
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to 30 seconds ago
      const oldTimestamp = new Date(Date.now() - 30000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(oldTimestamp, agent.id);

      const staleAgents = getStaleAgents(db, 15);

      expect(staleAgents.length).toBeGreaterThan(0);
      expect(staleAgents[0].id).toBe(agent.id);
      expect(staleAgents[0].seconds_since_heartbeat).toBeGreaterThan(15);
    });

    it('should not return agents with current heartbeats', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      updateAgentHeartbeat(db, agent.id);

      const staleAgents = getStaleAgents(db, 15);

      expect(staleAgents).toEqual([]);
    });

    it('should respect timeout parameter', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to 10 seconds ago
      const timestamp = new Date(Date.now() - 10000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(timestamp, agent.id);

      // With 5 second timeout, should be stale
      const staleWith5 = getStaleAgents(db, 5);
      expect(staleWith5.length).toBeGreaterThan(0);

      // With 20 second timeout, should not be stale
      const staleWith20 = getStaleAgents(db, 20);
      expect(staleWith20).toEqual([]);
    });

    it('should only return active agents (working/idle)', () => {
      const workingAgent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      const terminatedAgent = createAgent(db, {
        type: 'junior',
        teamId,
      });

      // Set both to old heartbeat
      const oldTimestamp = new Date(Date.now() - 30000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(oldTimestamp, workingAgent.id);
      db.prepare(`UPDATE agents SET last_seen = ?, status = 'terminated' WHERE id = ?`).run(
        oldTimestamp,
        terminatedAgent.id
      );

      const staleAgents = getStaleAgents(db, 15);

      // Should only include working/idle agents
      expect(staleAgents.some(a => a.id === workingAgent.id)).toBe(true);
      expect(staleAgents.some(a => a.id === terminatedAgent.id)).toBe(false);
    });

    it('should handle agents with null last_seen after grace period', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to null and created_at to old timestamp (> 60 + timeout seconds ago)
      const oldCreatedAt = new Date(Date.now() - 90000).toISOString(); // 90 seconds ago
      db.prepare(`UPDATE agents SET last_seen = NULL, created_at = ? WHERE id = ?`).run(
        oldCreatedAt,
        agent.id
      );

      const staleAgents = getStaleAgents(db, 15);

      // Should be detected as stale (older than 60 + 15 = 75 seconds)
      expect(staleAgents.some(a => a.id === agent.id)).toBe(true);
    });

    it('should not return recently created agents with null last_seen', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to null but keep recent created_at
      db.prepare(`UPDATE agents SET last_seen = NULL WHERE id = ?`).run(agent.id);

      const staleAgents = getStaleAgents(db, 15);

      // Should not be stale (within grace period)
      expect(staleAgents.some(a => a.id === agent.id)).toBe(false);
    });

    it('should calculate seconds_since_heartbeat correctly', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to exactly 30 seconds ago
      const timestamp = new Date(Date.now() - 30000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(timestamp, agent.id);

      const staleAgents = getStaleAgents(db, 15);

      const staleAgent = staleAgents.find(a => a.id === agent.id);
      expect(staleAgent).toBeDefined();
      // Should be approximately 30 seconds (allow some variance)
      expect(staleAgent!.seconds_since_heartbeat).toBeGreaterThanOrEqual(25);
      expect(staleAgent!.seconds_since_heartbeat).toBeLessThanOrEqual(35);
    });

    it('should return multiple stale agents', () => {
      const agent1 = createAgent(db, { type: 'senior', teamId });
      const agent2 = createAgent(db, { type: 'intermediate', teamId });
      const agent3 = createAgent(db, { type: 'junior', teamId });

      const oldTimestamp = new Date(Date.now() - 30000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id IN (?, ?, ?)`).run(
        oldTimestamp,
        agent1.id,
        agent2.id,
        agent3.id
      );

      const staleAgents = getStaleAgents(db, 15);

      expect(staleAgents.length).toBe(3);
    });
  });

  describe('isAgentHeartbeatCurrent', () => {
    it('should return true for agent with current heartbeat', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      updateAgentHeartbeat(db, agent.id);

      const isCurrent = isAgentHeartbeatCurrent(db, agent.id, 15);

      expect(isCurrent).toBe(true);
    });

    it('should return false for agent with stale heartbeat', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to 30 seconds ago
      const oldTimestamp = new Date(Date.now() - 30000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(oldTimestamp, agent.id);

      const isCurrent = isAgentHeartbeatCurrent(db, agent.id, 15);

      expect(isCurrent).toBe(false);
    });

    it('should return false for agent with null last_seen', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to null
      db.prepare(`UPDATE agents SET last_seen = NULL WHERE id = ?`).run(agent.id);

      const isCurrent = isAgentHeartbeatCurrent(db, agent.id, 15);

      expect(isCurrent).toBe(false);
    });

    it('should respect custom timeout', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      // Set last_seen to 10 seconds ago
      const timestamp = new Date(Date.now() - 10000).toISOString();
      db.prepare(`UPDATE agents SET last_seen = ? WHERE id = ?`).run(timestamp, agent.id);

      // With 5 second timeout, should be false
      expect(isAgentHeartbeatCurrent(db, agent.id, 5)).toBe(false);

      // With 20 second timeout, should be true
      expect(isAgentHeartbeatCurrent(db, agent.id, 20)).toBe(true);
    });

    it('should return false for non-existent agent', () => {
      const isCurrent = isAgentHeartbeatCurrent(db, 'non-existent-agent', 15);
      expect(isCurrent).toBe(false);
    });

    it('should use default timeout of 15 seconds', () => {
      const agent = createAgent(db, {
        type: 'senior',
        teamId,
      });

      updateAgentHeartbeat(db, agent.id);

      // Should use default 15 second timeout
      const isCurrent = isAgentHeartbeatCurrent(db, agent.id);

      expect(isCurrent).toBe(true);
    });
  });
});
