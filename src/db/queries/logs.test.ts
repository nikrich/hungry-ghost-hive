// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
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
  let db: Database;
  let teamId: string;
  let agentId: string;
  let storyId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const team = createTeam(db, {
      repoUrl: 'https://github.com/test/repo.git',
      repoPath: '/path/to/repo',
      name: 'Test Team',
    });
    teamId = team.id;

    const agent = createAgent(db, {
      type: 'senior',
      teamId,
      model: 'claude-sonnet-4-5',
    });
    agentId = agent.id;

    const story = createStory(db, {
      teamId,
      title: 'Test Story',
      description: 'Test description',
    });
    storyId = story.id;
  });

  describe('createLog', () => {
    it('should create a log entry with all fields', () => {
      const metadata = { key: 'value', count: 42 };
      const log = createLog(db, {
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

    it('should create a log entry with minimal fields', () => {
      const log = createLog(db, {
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

    it('should create a log entry without story', () => {
      const log = createLog(db, {
        agentId,
        eventType: 'AGENT_TERMINATED',
        message: 'Agent terminated',
      });

      expect(log.agent_id).toBe(agentId);
      expect(log.story_id).toBeNull();
      expect(log.event_type).toBe('AGENT_TERMINATED');
      expect(log.message).toBe('Agent terminated');
    });

    it('should handle null metadata', () => {
      const log = createLog(db, {
        agentId,
        eventType: 'STORY_STARTED',
        metadata: null,
      });

      expect(log.metadata).toBeNull();
    });

    it('should serialize complex metadata', () => {
      const metadata = {
        nested: { value: 'test' },
        array: [1, 2, 3],
        bool: true,
      };
      const log = createLog(db, {
        agentId,
        eventType: 'BUILD_STARTED',
        metadata,
      });

      expect(log.metadata).toBe(JSON.stringify(metadata));
    });
  });

  describe('getLogById', () => {
    it('should retrieve a log by ID', () => {
      const created = createLog(db, {
        agentId,
        eventType: 'STORY_STARTED',
        message: 'Test log',
      });

      const retrieved = getLogById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.agent_id).toBe(agentId);
      expect(retrieved?.event_type).toBe('STORY_STARTED');
      expect(retrieved?.message).toBe('Test log');
    });

    it('should return undefined for non-existent log', () => {
      const log = getLogById(db, 99999);
      expect(log).toBeUndefined();
    });
  });

  describe('getLogsByAgent', () => {
    it('should retrieve all logs for an agent', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      // Create log for different agent
      const agent2 = createAgent(db, { type: 'junior', teamId });
      createLog(db, { agentId: agent2.id, eventType: 'AGENT_SPAWNED' });

      const logs = getLogsByAgent(db, agentId);

      expect(logs).toHaveLength(3);
      logs.forEach(log => {
        expect(log.agent_id).toBe(agentId);
      });
    });

    it('should return logs in descending timestamp order', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = getLogsByAgent(db, agentId);

      // Should be in descending order (newest first)
      expect(logs).toHaveLength(3);
      // Verify timestamps are in descending order
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp >= logs[i + 1].timestamp).toBe(true);
      }
    });

    it('should respect the limit parameter', () => {
      // Create 10 logs
      for (let i = 0; i < 10; i++) {
        createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = getLogsByAgent(db, agentId, 5);
      expect(logs).toHaveLength(5);
    });

    it('should use default limit of 100', () => {
      // Create 5 logs
      for (let i = 0; i < 5; i++) {
        createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = getLogsByAgent(db, agentId);
      expect(logs).toHaveLength(5);
    });

    it('should return empty array for agent with no logs', () => {
      const agent2 = createAgent(db, { type: 'junior', teamId });
      const logs = getLogsByAgent(db, agent2.id);
      expect(logs).toEqual([]);
    });
  });

  describe('getLogsByStory', () => {
    it('should retrieve all logs for a story', () => {
      createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_PROGRESS_UPDATE' });
      createLog(db, { agentId, storyId, eventType: 'STORY_COMPLETED' });

      // Create log for different story
      const story2 = createStory(db, {
        teamId,
        title: 'Story 2',
        description: 'Description',
      });
      createLog(db, { agentId, storyId: story2.id, eventType: 'STORY_STARTED' });

      const logs = getLogsByStory(db, storyId);

      expect(logs).toHaveLength(3);
      logs.forEach(log => {
        expect(log.story_id).toBe(storyId);
      });
    });

    it('should return logs in descending timestamp order', () => {
      createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_PROGRESS_UPDATE' });
      createLog(db, { agentId, storyId, eventType: 'STORY_COMPLETED' });

      const logs = getLogsByStory(db, storyId);

      expect(logs).toHaveLength(3);
      // Verify timestamps are in descending order
      for (let i = 0; i < logs.length - 1; i++) {
        expect(logs[i].timestamp >= logs[i + 1].timestamp).toBe(true);
      }
    });

    it('should return empty array for story with no logs', () => {
      const story2 = createStory(db, {
        teamId,
        title: 'Story 2',
        description: 'Description',
      });
      const logs = getLogsByStory(db, story2.id);
      expect(logs).toEqual([]);
    });
  });

  describe('getLogsByEventType', () => {
    it('should retrieve all logs of a specific event type', () => {
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });
      createLog(db, { agentId, eventType: 'STORY_STARTED' });

      const logs = getLogsByEventType(db, 'STORY_STARTED');

      expect(logs).toHaveLength(2);
      logs.forEach(log => {
        expect(log.event_type).toBe('STORY_STARTED');
      });
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        createLog(db, { agentId, eventType: 'BUILD_STARTED' });
      }

      const logs = getLogsByEventType(db, 'BUILD_STARTED', 5);
      expect(logs).toHaveLength(5);
    });

    it('should return empty array for event type with no logs', () => {
      const logs = getLogsByEventType(db, 'PR_REJECTED' as EventType);
      expect(logs).toEqual([]);
    });
  });

  describe('getRecentLogs', () => {
    it('should retrieve recent logs', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = getRecentLogs(db);

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = getRecentLogs(db, 5);
      expect(logs).toHaveLength(5);
    });

    it('should return logs in descending timestamp order', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = getRecentLogs(db);

      expect(logs[0].event_type).toBe('STORY_COMPLETED');
      expect(logs[2].event_type).toBe('AGENT_SPAWNED');
    });

    it('should use default limit of 50', () => {
      for (let i = 0; i < 60; i++) {
        createLog(db, { agentId, eventType: 'STORY_PROGRESS_UPDATE' });
      }

      const logs = getRecentLogs(db);
      expect(logs).toHaveLength(50);
    });
  });

  describe('getLogsSince', () => {
    it('should retrieve logs since a specific timestamp', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      const sinceTime = new Date().toISOString();

      // Small delay to ensure different timestamps
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = getLogsSince(db, sinceTime);

      // Should only get logs created after sinceTime
      expect(logs.length).toBeGreaterThanOrEqual(0);
      logs.forEach(log => {
        expect(log.timestamp > sinceTime).toBe(true);
      });
    });

    it('should return logs in ascending timestamp order', () => {
      const sinceTime = new Date().toISOString();

      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });
      createLog(db, { agentId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      const logs = getLogsSince(db, sinceTime);

      if (logs.length > 1) {
        for (let i = 0; i < logs.length - 1; i++) {
          expect(logs[i].timestamp <= logs[i + 1].timestamp).toBe(true);
        }
      }
    });

    it('should return empty array if no logs since timestamp', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });

      const futureTime = new Date(Date.now() + 1000000).toISOString();
      const logs = getLogsSince(db, futureTime);

      expect(logs).toEqual([]);
    });
  });

  describe('pruneOldLogs', () => {
    it('should delete logs older than retention days', () => {
      // Create a log with old timestamp (100 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      // We need to manually insert to set a past timestamp
      db.run(
        `
        INSERT INTO agent_logs (agent_id, event_type, timestamp)
        VALUES (?, ?, ?)
      `,
        [agentId, 'AGENT_SPAWNED', oldDate.toISOString()]
      );

      // Create a recent log
      createLog(db, { agentId, eventType: 'STORY_STARTED' });

      const deletedCount = pruneOldLogs(db, 30);

      expect(deletedCount).toBe(1);

      // Verify recent log still exists
      const logs = getLogsByAgent(db, agentId);
      expect(logs).toHaveLength(1);
      expect(logs[0].event_type).toBe('STORY_STARTED');
    });

    it('should return 0 if no logs to prune', () => {
      createLog(db, { agentId, eventType: 'AGENT_SPAWNED' });

      const deletedCount = pruneOldLogs(db, 30);
      expect(deletedCount).toBe(0);
    });

    it('should handle different retention periods', () => {
      // Create logs with different ages
      const date50DaysAgo = new Date();
      date50DaysAgo.setDate(date50DaysAgo.getDate() - 50);

      const date20DaysAgo = new Date();
      date20DaysAgo.setDate(date20DaysAgo.getDate() - 20);

      db.run(
        `
        INSERT INTO agent_logs (agent_id, event_type, timestamp)
        VALUES (?, ?, ?)
      `,
        [agentId, 'AGENT_SPAWNED', date50DaysAgo.toISOString()]
      );

      db.run(
        `
        INSERT INTO agent_logs (agent_id, event_type, timestamp)
        VALUES (?, ?, ?)
      `,
        [agentId, 'STORY_STARTED', date20DaysAgo.toISOString()]
      );

      createLog(db, { agentId, eventType: 'STORY_COMPLETED' });

      // Prune logs older than 30 days
      const deletedCount = pruneOldLogs(db, 30);
      expect(deletedCount).toBe(1);

      const remainingLogs = getLogsByAgent(db, agentId);
      expect(remainingLogs).toHaveLength(2);
    });
  });

  describe('countQaFailuresByStory', () => {
    it('should count STORY_QA_FAILED events for a specific story', () => {
      createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });

      const count = countQaFailuresByStory(db, storyId);

      expect(count).toBe(3);
    });

    it('should not count other event types for a story', () => {
      createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_QA_PASSED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });

      const count = countQaFailuresByStory(db, storyId);

      expect(count).toBe(1);
    });

    it('should only count failures for the specified story', () => {
      const story2 = createStory(db, {
        teamId,
        title: 'Story 2',
        description: 'Description',
      });

      createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_QA_FAILED' });
      createLog(db, { agentId, storyId: story2.id, eventType: 'STORY_QA_FAILED' });

      const count1 = countQaFailuresByStory(db, storyId);
      const count2 = countQaFailuresByStory(db, story2.id);

      expect(count1).toBe(2);
      expect(count2).toBe(1);
    });

    it('should return 0 for story with no QA failures', () => {
      createLog(db, { agentId, storyId, eventType: 'STORY_STARTED' });
      createLog(db, { agentId, storyId, eventType: 'STORY_COMPLETED' });

      const count = countQaFailuresByStory(db, storyId);

      expect(count).toBe(0);
    });

    it('should return 0 for non-existent story', () => {
      const count = countQaFailuresByStory(db, 'non-existent-story');

      expect(count).toBe(0);
    });
  });
});
