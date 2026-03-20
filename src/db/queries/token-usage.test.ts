// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteProvider } from '../provider.js';
import {
  getTokensByAgent,
  getTokensByRequirement,
  getTokensByStory,
  getTotalTokens,
  recordTokenUsage,
} from './token-usage.js';
import { createTestDatabase } from './test-helpers.js';

async function createTokenUsageTestDatabase() {
  const rawDb = await createTestDatabase();
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      story_id TEXT,
      requirement_id TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      model TEXT,
      session_id TEXT,
      recorded_at TIMESTAMP NOT NULL
    )
  `);
  return rawDb;
}

describe('token-usage queries', () => {
  let db: SqliteProvider;

  beforeEach(async () => {
    const rawDb = await createTokenUsageTestDatabase();
    db = new SqliteProvider(rawDb);
  });

  describe('recordTokenUsage', () => {
    it('should insert a token usage record and return it', async () => {
      const row = await recordTokenUsage(db, {
        agentId: 'agent-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      expect(row.id).toBeDefined();
      expect(row.agent_id).toBe('agent-1');
      expect(row.input_tokens).toBe(100);
      expect(row.output_tokens).toBe(200);
      expect(row.total_tokens).toBe(300);
      expect(row.story_id).toBeNull();
      expect(row.requirement_id).toBeNull();
      expect(row.model).toBeNull();
      expect(row.session_id).toBeNull();
      expect(row.recorded_at).toBeDefined();
    });

    it('should store optional fields when provided', async () => {
      const row = await recordTokenUsage(db, {
        agentId: 'agent-2',
        storyId: 'story-abc',
        requirementId: 'req-xyz',
        inputTokens: 50,
        outputTokens: 75,
        totalTokens: 125,
        model: 'claude-opus-4-6',
        sessionId: 'session-99',
      });

      expect(row.story_id).toBe('story-abc');
      expect(row.requirement_id).toBe('req-xyz');
      expect(row.model).toBe('claude-opus-4-6');
      expect(row.session_id).toBe('session-99');
    });

    it('should treat empty string storyId/requirementId as null', async () => {
      const row = await recordTokenUsage(db, {
        agentId: 'agent-3',
        storyId: '',
        requirementId: '',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });

      expect(row.story_id).toBeNull();
      expect(row.requirement_id).toBeNull();
    });

    it('should assign incrementing ids', async () => {
      const row1 = await recordTokenUsage(db, {
        agentId: 'agent-1',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      });
      const row2 = await recordTokenUsage(db, {
        agentId: 'agent-1',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      });

      expect(row2.id).toBeGreaterThan(row1.id);
    });
  });

  describe('getTokensByAgent', () => {
    it('should return all records for the given agent', async () => {
      await recordTokenUsage(db, {
        agentId: 'agent-A',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-A',
        inputTokens: 5,
        outputTokens: 5,
        totalTokens: 10,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-B',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      const rows = await getTokensByAgent(db, 'agent-A');

      expect(rows.length).toBe(2);
      expect(rows.every(r => r.agent_id === 'agent-A')).toBe(true);
    });

    it('should return empty array when agent has no records', async () => {
      const rows = await getTokensByAgent(db, 'unknown-agent');
      expect(rows).toEqual([]);
    });

    it('should return records ordered by recorded_at descending', async () => {
      const earlier = new Date(Date.now() - 10000).toISOString();
      const later = new Date().toISOString();

      db.db.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
        ['agent-X', 1, 1, 2, earlier]
      );
      db.db.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
        ['agent-X', 3, 3, 6, later]
      );

      const rows = await getTokensByAgent(db, 'agent-X');

      expect(rows.length).toBe(2);
      expect(rows[0].recorded_at >= rows[1].recorded_at).toBe(true);
    });
  });

  describe('getTokensByStory', () => {
    it('should return all records for the given story', async () => {
      await recordTokenUsage(db, {
        agentId: 'agent-1',
        storyId: 'story-1',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-2',
        storyId: 'story-1',
        inputTokens: 5,
        outputTokens: 5,
        totalTokens: 10,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-1',
        storyId: 'story-2',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      const rows = await getTokensByStory(db, 'story-1');

      expect(rows.length).toBe(2);
      expect(rows.every(r => r.story_id === 'story-1')).toBe(true);
    });

    it('should return empty array when story has no records', async () => {
      const rows = await getTokensByStory(db, 'nonexistent-story');
      expect(rows).toEqual([]);
    });

    it('should return records ordered by recorded_at descending', async () => {
      const earlier = new Date(Date.now() - 10000).toISOString();
      const later = new Date().toISOString();

      db.db.run(
        `INSERT INTO token_usage (agent_id, story_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['agent-1', 'story-ord', 1, 1, 2, earlier]
      );
      db.db.run(
        `INSERT INTO token_usage (agent_id, story_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['agent-1', 'story-ord', 3, 3, 6, later]
      );

      const rows = await getTokensByStory(db, 'story-ord');

      expect(rows[0].recorded_at >= rows[1].recorded_at).toBe(true);
    });
  });

  describe('getTokensByRequirement', () => {
    it('should return all records for the given requirement', async () => {
      await recordTokenUsage(db, {
        agentId: 'agent-1',
        requirementId: 'req-1',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-2',
        requirementId: 'req-1',
        inputTokens: 5,
        outputTokens: 5,
        totalTokens: 10,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-1',
        requirementId: 'req-2',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      const rows = await getTokensByRequirement(db, 'req-1');

      expect(rows.length).toBe(2);
      expect(rows.every(r => r.requirement_id === 'req-1')).toBe(true);
    });

    it('should return empty array when requirement has no records', async () => {
      const rows = await getTokensByRequirement(db, 'nonexistent-req');
      expect(rows).toEqual([]);
    });

    it('should return records ordered by recorded_at descending', async () => {
      const earlier = new Date(Date.now() - 10000).toISOString();
      const later = new Date().toISOString();

      db.db.run(
        `INSERT INTO token_usage (agent_id, requirement_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['agent-1', 'req-ord', 1, 1, 2, earlier]
      );
      db.db.run(
        `INSERT INTO token_usage (agent_id, requirement_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['agent-1', 'req-ord', 3, 3, 6, later]
      );

      const rows = await getTokensByRequirement(db, 'req-ord');

      expect(rows[0].recorded_at >= rows[1].recorded_at).toBe(true);
    });
  });

  describe('getTotalTokens', () => {
    it('should return zeroes when no records exist', async () => {
      const summary = await getTotalTokens(db);

      expect(summary.total_input_tokens).toBe(0);
      expect(summary.total_output_tokens).toBe(0);
      expect(summary.total_tokens).toBe(0);
      expect(summary.record_count).toBe(0);
    });

    it('should sum all token records when no options provided', async () => {
      await recordTokenUsage(db, {
        agentId: 'agent-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });
      await recordTokenUsage(db, {
        agentId: 'agent-2',
        inputTokens: 50,
        outputTokens: 75,
        totalTokens: 125,
      });

      const summary = await getTotalTokens(db);

      expect(summary.total_input_tokens).toBe(150);
      expect(summary.total_output_tokens).toBe(275);
      expect(summary.total_tokens).toBe(425);
      expect(summary.record_count).toBe(2);
    });

    it('should filter by since date', async () => {
      const past = new Date(Date.now() - 10000).toISOString();
      const recent = new Date().toISOString();
      const cutoff = new Date(Date.now() - 5000).toISOString();

      db.db.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
        ['agent-1', 100, 200, 300, past]
      );
      db.db.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
        ['agent-2', 50, 75, 125, recent]
      );

      const summary = await getTotalTokens(db, { since: cutoff });

      expect(summary.record_count).toBe(1);
      expect(summary.total_input_tokens).toBe(50);
      expect(summary.total_output_tokens).toBe(75);
      expect(summary.total_tokens).toBe(125);
    });

    it('should filter by until date', async () => {
      const past = new Date(Date.now() - 10000).toISOString();
      const recent = new Date().toISOString();
      const cutoff = new Date(Date.now() - 5000).toISOString();

      db.db.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
        ['agent-1', 100, 200, 300, past]
      );
      db.db.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
        ['agent-2', 50, 75, 125, recent]
      );

      const summary = await getTotalTokens(db, { until: cutoff });

      expect(summary.record_count).toBe(1);
      expect(summary.total_input_tokens).toBe(100);
    });

    it('should filter by both since and until', async () => {
      const t1 = new Date(Date.now() - 30000).toISOString();
      const t2 = new Date(Date.now() - 20000).toISOString();
      const t3 = new Date(Date.now() - 10000).toISOString();
      const t4 = new Date().toISOString();

      for (const [ts, tokens] of [
        [t1, 10],
        [t2, 20],
        [t3, 30],
        [t4, 40],
      ] as [string, number][]) {
        db.db.run(
          `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at) VALUES (?, ?, ?, ?, ?)`,
          ['agent-1', tokens, tokens, tokens * 2, ts]
        );
      }

      // Only t2 and t3 fall in range [t2, t3]
      const summary = await getTotalTokens(db, { since: t2, until: t3 });

      expect(summary.record_count).toBe(2);
      expect(summary.total_input_tokens).toBe(50); // 20 + 30
    });

    it('should return zeroes for a date range with no records', async () => {
      await recordTokenUsage(db, {
        agentId: 'agent-1',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      const futureDate = new Date(Date.now() + 1000000).toISOString();
      const summary = await getTotalTokens(db, { since: futureDate });

      expect(summary.total_input_tokens).toBe(0);
      expect(summary.total_output_tokens).toBe(0);
      expect(summary.total_tokens).toBe(0);
      expect(summary.record_count).toBe(0);
    });
  });
});
