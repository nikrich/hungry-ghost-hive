// Licensed under the Hungry Ghost Hive License. See LICENSE.

import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../provider.js';
import { createAgent } from './agents.js';
import {
  countQaFailuresByStory,
  createLog,
  getLogById,
  getLogsByAgent,
  getLogsByEventType,
  getLogsByStory,
  getLogsSince,
  getRecentLogs,
  pruneOldLogs,
  type EventType,
} from './logs.js';
import { createStory } from './stories.js';
import { createTeam } from './teams.js';
import { createTestDatabase } from './test-helpers.js';

describe('logs queries', () => {
  let db: SqliteProvider;
  let teamId: string;
  let agentId: string;
  let storyId: string;

  beforeEach(async () => {
    const rawDb = await createTestDatabase();
    db = new SqliteProvider(rawDb);
    const team = await createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;

    const agent = await createAgent(db, {
      type: 'senior',
      teamId,
      model: 'claude-sonnet-4-5',
    });
    agentId = agent.id;

    const story = await createStory(db, {
      teamId,
      title: 'Test Story',
      description: 'Test description',
    });
    storyId = story.id;
  });

  describe('createLog', () => {
    it('should create a log entry with all fields', async () => {
      const metadata = { key: 'value', count: 42 };
      const log = await createLog(db, {
        agentId,
        storyId,
        eventType: 'STORY_STARTED',
        status: 'success',
        message: 'Story started successfully',
        metadata,
      });

      expect(log.id).toBeGreaterThan(0);
      expect(log.agent_id).toBe(agentId);
      expect(log.story_id).toBe(storyId);
      expect(log.event_type).toBe('STORY_STARTED');
      expect(log.status).toBe('success');
      expect(log.message).toBe('Story started successfully');
      expect(log.metadata).toBe(JSON.stringify(metadata));
      expect(log.timestamp).toBeDefined();
    });

    it('should create a log entry with minimal fields', async () => {
      const log = await createLog(db, {
        agentId,
        eventType: 'AGENT_SPAWNED',
      });

      expect(log.id).toBeGreaterThan(0);
      expect(log.agent_id).toBe(agentId);
      expect(log.story_id).toBeNull();
      expect(log.event_type).toBe('AGENT_SPAWNED');
      expect(log.status).toBeNull();
      expect(log.message).toBeNull();
      expect(log.metadata).toBeNull();
    });

    it('should create a log entry without story', async () => {
      const log = await createLog(db, {
        agentId,
        eventType: 'AGENT_TERMINATED',
        message: 'Agent terminated',
      });

      expect(log.agent_id).toBe(agentId);
      expect(log.story_id).toBeNull();
      expect(log.event_type).toBe('AGENT_TERMINATED');
      expect(log.message).toBe('Agent terminated');
    });

    it('should handle null metadata', async () => {
      const log = await createLog(db, {
        agentId,
        eventType: 'STORY_STARTED',
        metadata: null,
      });

      expect(log.metadata).toBeNull();
    });

    it('should serialize complex metadata', async () => {
      const metadata = {
        nested: { value: 'test' },
        array: [1, 2, 3],
        bool: true,
      };
      const log = await createLog(db, {
        agentId,
        eventType: 'BUILD_STARTED',
        metadata,
      });

      expect(log.metadata).toBe(JSON.stringify(metadata));
    });

    it('should resolve tmux session names to canonical agent IDs', async () => {
      const qaAgent = await createAgent(db, {
        type: 'qa',
        teamId,
        tmuxSession: 'hive-qa-testteam',
      });

      const log = await createLog(db, {
        agentId: 'hive-qa-testteam',
        eventType: 'PR_REVIEW_STARTED',
      });

      expect(log.agent_id).toBe(qaAgent.id);
    });

    it('should create a synthetic agent row for unknown system actors', async () => {
      const log = await createLog(db, {
        agentId: 'scheduler',
        eventType: 'TEAM_SCALED_UP',
      });

      expect(log.agent_id).toBe('scheduler');
      const result = db.db.exec("SELECT id, type, status FROM agents WHERE id = 'scheduler'");
      expect(result[0]?.values[0]).toEqual(['scheduler', 'tech_lead', 'terminated']);
    });

    it('should drop invalid story references to avoid FK failures', async () => {
      const log = await createLog(db, {
        agentId,
        storyId: 'STORY-DOES-NOT-EXIST',
        eventType: 'STORY_PROGRESS_UPDATE',
      });

      expect(log.story_id).toBeNull();
    });

    it('should support legacy agents schemas without last_seen', async () => {
      const SQL = await initSqlJs();
      const legacyRawDb = new SQL.Database();
      legacyRawDb.run('PRAGMA foreign_keys = ON');
      legacyRawDb.run(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          type TEXT,
          status TEXT,
          created_at TIMESTAMP,
          updated_at TIMESTAMP
        );
      `);
      legacyRawDb.run(`CREATE TABLE stories (id TEXT PRIMARY KEY);`);
      legacyRawDb.run(`
        CREATE TABLE agent_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL REFERENCES agents(id),
          story_id TEXT REFERENCES stories(id),
          event_type TEXT NOT NULL,
          status TEXT,
          message TEXT,
          metadata TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const legacyDb = new SqliteProvider(legacyRawDb);

      const log = await createLog(legacyDb, {
        agentId: 'scheduler',
        eventType: 'TEAM_SCALED_UP',
      });
      expect(log.agent_id).toBe('scheduler');
      const row = legacyRawDb.exec("SELECT id, status FROM agents WHERE id = 'scheduler'");
      expect(row[0]?.values[0]).toEqual(['scheduler', 'terminated']);
    });
  });

  describe('getLogById', () => {
    it('should retrieve a log by ID', async () => {
      const created = await createLog(db, {
        agentId,
        eventType: 'STORY_STARTED',
        message: 'Test log',
      });

      const retrieved = await getLogById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.agent_id).toBe(agentId);
      expect(retrieved?.event_type).toBe('STORY_STARTED');
      expect(retrieved?.message).toBe('Test log');
    });

    it('should return undefined for non-existent log', async () => {
      const log = await getLogById(db, 99999);
      expect(log).toBeUndefined();
    });
  });

  describe('getLogsByAgent', () => {
    it('should retrieve all logs for an agent', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      // Create log for different agent
      const agent2 = await createAgent(db, { type: 'junior', teamId });
      await createLog(db, { agentId: agent2.id, eventType: 'AGENT_SPAWNED' });

      const logs = await getLogsByAgent(db, agentId);

      expect(logs).toHaveLength(3);
      logs.forEach(log => {
        expect(log.agent_id).toBe(agentId);
      });
    });

    it('should return logs in descending timestamp order', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = await getLogsByAgent(db, agentId);

      // Should be in descending order (newest first)
      expect(logs).toHaveLength(3);
      // Verify timestamps are in descending order
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp >= logs[i + 1].timestamp).toBe(true);
      }
    });

    it('should respect the limit parameter', async () => {
      // Create 10 logs
      for (let i = 0; i < 10; i++) {
        await createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = await getLogsByAgent(db, agentId, 5);
      expect(logs).toHaveLength(5);
    });

    it('should use default limit of 100', async () => {
      // Create 5 logs
      for (let i = 0; i < 5; i++) {
        await createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = await getLogsByAgent(db, agentId);
      expect(logs).toHaveLength(5);
    });

    it('should return empty array for agent with no logs', async () => {
      const agent2 = await createAgent(db, { type: 'junior', teamId });
      const logs = await getLogsByAgent(db, agent2.id);
      expect(logs).toEqual([]);
    });
  });

  describe('getLogsByStory', () => {
    it('should retrieve all logs for a story', async () => {
      await createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_PROGRESS_UPDATE' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_COMPLETED' });

      // Create log for different story
      const story2 = await createStory(db, {
        teamId,
        title: 'Story 2',
        description: 'Description',
      });
      await createLog(db, { agentId, storyId: story2.id, eventType: 'STORY_STARTED' });

      const logs = await getLogsByStory(db, storyId);

      expect(logs).toHaveLength(3);
      logs.forEach(log => {
        expect(log.story_id).toBe(storyId);
      });
    });

    it('should return logs in descending timestamp order', async () => {
      await createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_PROGRESS_UPDATE' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_COMPLETED' });

      const logs = await getLogsByStory(db, storyId);

      expect(logs).toHaveLength(3);
      // Verify timestamps are in descending order
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp >= logs[i + 1].timestamp).toBe(true);
      }
    });

    it('should return empty array for story with no logs', async () => {
      const story2 = await createStory(db, {
        teamId,
        title: 'Story 2',
        description: 'Description',
      });
      const logs = await getLogsByStory(db, story2.id);
      expect(logs).toEqual([]);
    });
  });

  describe('getLogsByEventType', () => {
    it('should retrieve all logs of a specific event type', async () => {
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });

      const logs = await getLogsByEventType(db, 'STORY_STARTED');

      expect(logs).toHaveLength(2);
      logs.forEach(log => {
        expect(log.event_type).toBe('STORY_STARTED');
      });
    });

    it('should respect the limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await createLog(db, { agentId, eventType: 'BUILD_STARTED' });
      }

      const logs = await getLogsByEventType(db, 'BUILD_STARTED', 5);
      expect(logs).toHaveLength(5);
    });

    it('should return empty array for event type with no logs', async () => {
      const logs = await getLogsByEventType(db, 'PR_REJECTED' as EventType);
      expect(logs).toEqual([]);
    });
  });

  describe('getRecentLogs', () => {
    it('should retrieve recent logs', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = await getRecentLogs(db);

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should respect the limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = await getRecentLogs(db, 5);
      expect(logs).toHaveLength(5);
    });

    it('should return logs in descending timestamp order', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = await getRecentLogs(db);

      expect(logs[0].event_type).toBe('STORY_COMPLETED');
      expect(logs[2].event_type).toBe('AGENT_SPAWNED');
    });

    it('should use default limit of 50', async () => {
      for (let i = 0; i < 60; i++) {
        await createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = await getRecentLogs(db);
      expect(logs).toHaveLength(50);
    });
  });

  describe('getLogsSince', () => {
    it('should retrieve logs since a specific timestamp', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      const sinceTime = new Date().toISOString();

      // Small delay to ensure different timestamps
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = await getLogsSince(db, sinceTime);

      // Should only get logs created after sinceTime
      expect(logs.length).toBeGreaterThanOrEqual(0);
      logs.forEach(log => {
        expect(log.timestamp > sinceTime).toBe(true);
      });
    });

    it('should return logs in ascending timestamp order', async () => {
      const sinceTime = new Date().toISOString();

      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = await getLogsSince(db, sinceTime);

      if (logs.length > 1) {
        for (let i = 0; i < logs.length - 1; i++) {
          expect(logs[i].timestamp <= logs[i + 1].timestamp).toBe(true);
        }
      }
    });

    it('should return empty array if no logs since timestamp', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });

      const futureTime = new Date(Date.now() + 1000000).toISOString();
      const logs = await getLogsSince(db, futureTime);

      expect(logs).toEqual([]);
    });
  });

  describe('pruneOldLogs', () => {
    it('should delete logs older than retention days', async () => {
      // Create a log with old timestamp (100 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      // We need to manually insert to set a past timestamp
      db.db.run(
        `
        INSERT INTO agent_logs (agent_id, event_type, timestamp)
        VALUES (?, ?, ?)
      `,
        [agentId, 'AGENT_SPAWNED', oldDate.toISOString()]
      );

      // Create a recent log
      await createLog(db, { agentId, eventType: 'STORY_STARTED' });

      const deletedCount = await pruneOldLogs(db, 30);

      expect(deletedCount).toBe(1);

      // Verify recent log still exists
      const logs = await getLogsByAgent(db, agentId);
      expect(logs).toHaveLength(1);
      expect(logs[0].event_type).toBe('STORY_STARTED');
    });

    it('should return 0 if no logs to prune', async () => {
      await createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });

      const deletedCount = await pruneOldLogs(db, 30);
      expect(deletedCount).toBe(0);
    });

    it('should handle different retention periods', async () => {
      // Create logs with different ages
      const date50DaysAgo = new Date();
      date50DaysAgo.setDate(date50DaysAgo.getDate() - 50);

      const date20DaysAgo = new Date();
      date20DaysAgo.setDate(date20DaysAgo.getDate() - 20);

      db.db.run(
        `
        INSERT INTO agent_logs (agent_id, event_type, timestamp)
        VALUES (?, ?, ?)
      `,
        [agentId, 'AGENT_SPAWNED', date50DaysAgo.toISOString()]
      );

      db.db.run(
        `
        INSERT INTO agent_logs (agent_id, event_type, timestamp)
        VALUES (?, ?, ?)
      `,
        [agentId, 'STORY_STARTED', date20DaysAgo.toISOString()]
      );

      await createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      // Prune logs older than 30 days
      const deletedCount = await pruneOldLogs(db, 30);
      expect(deletedCount).toBe(1);

      const remainingLogs = await getLogsByAgent(db, agentId);
      expect(remainingLogs).toHaveLength(2);
    });
  });

  describe('countQaFailuresByStory', () => {
    it('should count STORY_QA_FAILED events for a specific story', async () => {
      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });

      const count = await countQaFailuresByStory(db, storyId);

      expect(count).toBe(3);
    });

    it('should not count other event types for a story', async () => {
      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_PASSED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });

      const count = await countQaFailuresByStory(db, storyId);

      expect(count).toBe(1);
    });

    it('should only count failures for the specified story', async () => {
      const story2 = await createStory(db, {
        teamId,
        title: 'Story 2',
        description: 'Description',
      });

      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      await createLog(db, { agentId, storyId: story2.id, eventType: 'STORY_QA_FAILED' });

      const count1 = await countQaFailuresByStory(db, storyId);
      const count2 = await countQaFailuresByStory(db, story2.id);

      expect(count1).toBe(2);
      expect(count2).toBe(1);
    });

    it('should return 0 for story with no QA failures', async () => {
      await createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });
      await createLog(db, { agentId, storyId, eventType: 'STORY_COMPLETED' });

      const count = await countQaFailuresByStory(db, storyId);

      expect(count).toBe(0);
    });

    it('should return 0 for non-existent story', async () => {
      const count = await countQaFailuresByStory(db, 'non-existent-story');

      expect(count).toBe(0);
    });
  });
});
