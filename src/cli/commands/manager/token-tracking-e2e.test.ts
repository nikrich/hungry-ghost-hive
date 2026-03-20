// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * End-to-end integration tests for the token usage tracking pipeline.
 *
 * These tests verify the full flow:
 *   tmux pane output → token parser → DB persist → DB query
 *
 * Only the tmux layer (captureTmuxPane) is mocked. The parser, database
 * write (recordTokenUsage), and database read (getTokensByAgent, etc.)
 * all use their real implementations with an in-memory SQLite database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProvider } from '../../../db/provider.js';
import { createTestDatabase } from '../../../db/queries/test-helpers.js';
import {
  getTokensByAgent,
  getTokensByStory,
  getTotalTokens,
} from '../../../db/queries/token-usage.js';
import {
  captureAndPersistTokenUsage,
  clearTokenDeduplicationState,
  parseAndPersistTokenUsage,
  parseAndPersistTokenUsageIfChanged,
} from './token-capture.js';

// Only mock the tmux layer — everything else is real
const { mockCaptureTmuxPane } = vi.hoisted(() => ({
  mockCaptureTmuxPane: vi.fn(),
}));
vi.mock('../../../tmux/manager.js', () => ({
  captureTmuxPane: mockCaptureTmuxPane,
}));

async function createE2EDatabase(): Promise<SqliteProvider> {
  const rawDb = await createTestDatabase();

  // Add token_usage table (not in base test-helpers schema)
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

  // Insert a test agent row so agent_logs FK constraints pass
  rawDb.run(`
    INSERT INTO agents (id, type, status)
    VALUES ('agent-e2e', 'junior', 'working')
  `);

  return new SqliteProvider(rawDb);
}

function createE2ECtx(provider: SqliteProvider) {
  return {
    verbose: false,
    config: {} as any,
    root: '/test',
    paths: {} as any,
    hiveSessions: [],
    counters: {} as any,
    escalatedSessions: new Set<string | null>(),
    agentsBySessionName: new Map(),
    messagesToMarkRead: [],
    withDb: vi.fn(async (fn: any) => {
      const dbWrapper = { provider, save: vi.fn() };
      return fn(dbWrapper, {});
    }),
  };
}

describe('token usage tracking — end-to-end', () => {
  let provider: SqliteProvider;

  beforeEach(async () => {
    provider = await createE2EDatabase();
    mockCaptureTmuxPane.mockReset();
    clearTokenDeduplicationState();
  });

  describe('parseAndPersistTokenUsage → real DB read', () => {
    it('should persist Claude Code format tokens and read them back via getTokensByAgent', async () => {
      const ctx = createE2ECtx(provider);
      const claudeOutput = [
        'Working on your request...',
        'Total input tokens: 12,345',
        'Total output tokens: 7,890',
        'Total tokens: 20,235',
        'Total cost: $1.23',
      ].join('\n');

      const result = await parseAndPersistTokenUsage(
        claudeOutput,
        ctx as any,
        'agent-e2e',
        'story-1'
      );

      expect(result.captured).toBe(true);
      expect(result.persisted).toBe(true);
      expect(result.tokens).toMatchObject({
        inputTokens: 12345,
        outputTokens: 7890,
        totalTokens: 20235,
      });

      // Verify the record was actually written to the DB
      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(1);
      expect(rows[0].agent_id).toBe('agent-e2e');
      expect(rows[0].story_id).toBe('story-1');
      expect(rows[0].input_tokens).toBe(12345);
      expect(rows[0].output_tokens).toBe(7890);
      expect(rows[0].total_tokens).toBe(20235);
      expect(rows[0].recorded_at).toBeDefined();
    });

    it('should persist Codex format tokens and read them back', async () => {
      const ctx = createE2ECtx(provider);
      const codexOutput = 'Tokens used: 15,000 (input: 8,000, output: 7,000)';

      const result = await parseAndPersistTokenUsage(codexOutput, ctx as any, 'agent-e2e');

      expect(result.persisted).toBe(true);
      expect(result.tokens).toMatchObject({
        inputTokens: 8000,
        outputTokens: 7000,
        totalTokens: 15000,
      });

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(1);
      expect(rows[0].input_tokens).toBe(8000);
      expect(rows[0].output_tokens).toBe(7000);
      expect(rows[0].total_tokens).toBe(15000);
    });

    it('should persist Gemini format tokens and read them back', async () => {
      const ctx = createE2ECtx(provider);
      const geminiOutput = 'Token count: input=5000, output=3000, total=8000';

      const result = await parseAndPersistTokenUsage(geminiOutput, ctx as any, 'agent-e2e');

      expect(result.persisted).toBe(true);
      expect(result.tokens).toMatchObject({
        inputTokens: 5000,
        outputTokens: 3000,
        totalTokens: 8000,
      });

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows[0].input_tokens).toBe(5000);
      expect(rows[0].output_tokens).toBe(3000);
      expect(rows[0].total_tokens).toBe(8000);
    });

    it('should not write to DB when output has no token data', async () => {
      const ctx = createE2ECtx(provider);

      const result = await parseAndPersistTokenUsage(
        'Just some random agent output with no token info',
        ctx as any,
        'agent-e2e'
      );

      expect(result.captured).toBe(true);
      expect(result.persisted).toBe(false);
      expect(result.tokens).toBeNull();

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(0);
    });

    it('should accumulate multiple records for the same agent', async () => {
      const ctx = createE2ECtx(provider);

      await parseAndPersistTokenUsage(
        'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500',
        ctx as any,
        'agent-e2e',
        'story-1'
      );

      await parseAndPersistTokenUsage(
        'Total input tokens: 2,000\nTotal output tokens: 1,000\nTotal tokens: 3,000',
        ctx as any,
        'agent-e2e',
        'story-1'
      );

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(2);
      const totals = rows.map(r => r.total_tokens).sort((a, b) => a - b);
      expect(totals).toEqual([1500, 3000]);
    });
  });

  describe('captureAndPersistTokenUsage (tmux → parser → DB)', () => {
    it('should capture from tmux, parse, and write to DB', async () => {
      const ctx = createE2ECtx(provider);
      mockCaptureTmuxPane.mockResolvedValue(
        'Total input tokens: 10,000\nTotal output tokens: 5,000\nTotal tokens: 15,000'
      );

      const result = await captureAndPersistTokenUsage(
        'hive-session-agent-e2e',
        ctx as any,
        'agent-e2e',
        'story-42'
      );

      expect(result.captured).toBe(true);
      expect(result.persisted).toBe(true);
      expect(mockCaptureTmuxPane).toHaveBeenCalledWith('hive-session-agent-e2e', 500);

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(1);
      expect(rows[0].story_id).toBe('story-42');
      expect(rows[0].input_tokens).toBe(10000);
      expect(rows[0].output_tokens).toBe(5000);
      expect(rows[0].total_tokens).toBe(15000);
    });

    it('should return captured=false when tmux returns empty output', async () => {
      const ctx = createE2ECtx(provider);
      mockCaptureTmuxPane.mockResolvedValue('');

      const result = await captureAndPersistTokenUsage(
        'hive-session-agent-e2e',
        ctx as any,
        'agent-e2e'
      );

      expect(result).toEqual({ captured: false, tokens: null, persisted: false });

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(0);
    });

    it('should return captured=false when tmux throws', async () => {
      const ctx = createE2ECtx(provider);
      mockCaptureTmuxPane.mockRejectedValue(new Error('tmux: no server running'));

      const result = await captureAndPersistTokenUsage(
        'hive-session-agent-e2e',
        ctx as any,
        'agent-e2e'
      );

      expect(result).toEqual({ captured: false, tokens: null, persisted: false });
    });
  });

  describe('getTotalTokens aggregation after real writes', () => {
    it('should return correct totals after multiple records', async () => {
      const ctx = createE2ECtx(provider);

      await parseAndPersistTokenUsage(
        'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500',
        ctx as any,
        'agent-e2e'
      );

      await parseAndPersistTokenUsage(
        'Total input tokens: 3,000\nTotal output tokens: 1,500\nTotal tokens: 4,500',
        ctx as any,
        'agent-e2e'
      );

      const summary = await getTotalTokens(provider);
      expect(summary.record_count).toBe(2);
      expect(summary.total_input_tokens).toBe(4000);
      expect(summary.total_output_tokens).toBe(2000);
      expect(summary.total_tokens).toBe(6000);
    });

    it('should filter by since date to exclude older records', async () => {
      const ctx = createE2ECtx(provider);

      // Write a record with an explicit past timestamp
      await provider.run(
        `INSERT INTO token_usage (agent_id, input_tokens, output_tokens, total_tokens, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['agent-e2e', 500, 250, 750, '2020-01-01T00:00:00.000Z']
      );

      // Write a recent record via the real pipeline
      await parseAndPersistTokenUsage(
        'Total input tokens: 2,000\nTotal output tokens: 1,000\nTotal tokens: 3,000',
        ctx as any,
        'agent-e2e'
      );

      const allTime = await getTotalTokens(provider);
      expect(allTime.record_count).toBe(2);
      expect(allTime.total_tokens).toBe(3750);

      const recent = await getTotalTokens(provider, { since: '2024-01-01T00:00:00.000Z' });
      expect(recent.record_count).toBe(1);
      expect(recent.total_tokens).toBe(3000);
    });
  });

  describe('getTokensByStory after real writes', () => {
    it('should return only records for the specified story', async () => {
      const ctx = createE2ECtx(provider);

      await parseAndPersistTokenUsage(
        'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500',
        ctx as any,
        'agent-e2e',
        'story-A'
      );

      await parseAndPersistTokenUsage(
        'Total input tokens: 2,000\nTotal output tokens: 1,000\nTotal tokens: 3,000',
        ctx as any,
        'agent-e2e',
        'story-B'
      );

      const storyARows = await getTokensByStory(provider, 'story-A');
      expect(storyARows).toHaveLength(1);
      expect(storyARows[0].total_tokens).toBe(1500);

      const storyBRows = await getTokensByStory(provider, 'story-B');
      expect(storyBRows).toHaveLength(1);
      expect(storyBRows[0].total_tokens).toBe(3000);
    });
  });

  describe('parseAndPersistTokenUsageIfChanged — deduplication with real DB', () => {
    it('should write to DB on first capture and verify record exists', async () => {
      const ctx = createE2ECtx(provider);
      const output = 'Total input tokens: 5,000\nTotal output tokens: 2,500\nTotal tokens: 7,500';

      const result = await parseAndPersistTokenUsageIfChanged(
        output,
        ctx as any,
        'agent-e2e',
        'story-1'
      );

      expect(result.captured).toBe(true);
      expect(result.persisted).toBe(true);
      expect(result.changed).toBe(true);

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(1);
      expect(rows[0].total_tokens).toBe(7500);
    });

    it('should skip DB write on second call with identical counts', async () => {
      const ctx = createE2ECtx(provider);
      const output = 'Total input tokens: 5,000\nTotal output tokens: 2,500\nTotal tokens: 7,500';

      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-e2e');

      // Same output again — should deduplicate
      const result = await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-e2e');

      expect(result.persisted).toBe(false);
      expect(result.changed).toBe(false);

      // Only one record should be in the DB
      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(1);
    });

    it('should write again when token counts increase', async () => {
      const ctx = createE2ECtx(provider);

      await parseAndPersistTokenUsageIfChanged(
        'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500',
        ctx as any,
        'agent-e2e'
      );

      const result = await parseAndPersistTokenUsageIfChanged(
        'Total input tokens: 2,000\nTotal output tokens: 1,000\nTotal tokens: 3,000',
        ctx as any,
        'agent-e2e'
      );

      expect(result.persisted).toBe(true);
      expect(result.changed).toBe(true);

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows).toHaveLength(2);
      const totals = rows.map(r => r.total_tokens).sort((a, b) => a - b);
      expect(totals).toEqual([1500, 3000]);
    });

    it('should track multiple agents independently and deduplicate per-agent', async () => {
      // Add a second agent to the DB so FK passes for agent-e2e-2
      await provider.run(
        `INSERT INTO agents (id, type, status) VALUES ('agent-e2e-2', 'senior', 'working')`
      );

      const ctx = createE2ECtx(provider);
      const output = 'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500';

      // First capture for both agents
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-e2e');
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-e2e-2');

      // Second call with same output — both should be deduplicated
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-e2e');
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-e2e-2');

      const agent1Rows = await getTokensByAgent(provider, 'agent-e2e');
      const agent2Rows = await getTokensByAgent(provider, 'agent-e2e-2');

      expect(agent1Rows).toHaveLength(1);
      expect(agent2Rows).toHaveLength(1);
    });
  });

  describe('inline Claude Code format parsing', () => {
    it('should parse "Input: X / Output: Y" inline format and persist correctly', async () => {
      const ctx = createE2ECtx(provider);
      const inlineOutput = 'Session summary: Input: 3,456 / Output: 1,234';

      const result = await parseAndPersistTokenUsage(inlineOutput, ctx as any, 'agent-e2e');

      expect(result.persisted).toBe(true);
      expect(result.tokens).toMatchObject({
        inputTokens: 3456,
        outputTokens: 1234,
        totalTokens: 4690,
      });

      const rows = await getTokensByAgent(provider, 'agent-e2e');
      expect(rows[0].input_tokens).toBe(3456);
      expect(rows[0].output_tokens).toBe(1234);
      expect(rows[0].total_tokens).toBe(4690);
    });
  });

  describe('full pipeline: tmux capture → parse → persist → aggregate', () => {
    it('should correctly accumulate total across multiple tmux captures', async () => {
      const ctx = createE2ECtx(provider);

      mockCaptureTmuxPane.mockResolvedValueOnce(
        'Total input tokens: 5,000\nTotal output tokens: 2,500\nTotal tokens: 7,500'
      );
      await captureAndPersistTokenUsage('session-1', ctx as any, 'agent-e2e', 'story-1');

      mockCaptureTmuxPane.mockResolvedValueOnce(
        'Total input tokens: 10,000\nTotal output tokens: 5,000\nTotal tokens: 15,000'
      );
      await captureAndPersistTokenUsage('session-1', ctx as any, 'agent-e2e', 'story-1');

      const summary = await getTotalTokens(provider);
      expect(summary.record_count).toBe(2);
      expect(summary.total_input_tokens).toBe(15000);
      expect(summary.total_output_tokens).toBe(7500);
      expect(summary.total_tokens).toBe(22500);

      const storyRows = await getTokensByStory(provider, 'story-1');
      expect(storyRows).toHaveLength(2);
    });
  });
});
