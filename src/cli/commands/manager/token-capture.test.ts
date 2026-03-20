// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureAndPersistTokenUsage,
  clearTokenDeduplicationState,
  parseAndPersistTokenUsage,
  parseAndPersistTokenUsageIfChanged,
} from './token-capture.js';

const { mockCaptureTmuxPane } = vi.hoisted(() => ({
  mockCaptureTmuxPane: vi.fn(),
}));
vi.mock('../../../tmux/manager.js', () => ({
  captureTmuxPane: mockCaptureTmuxPane,
}));

const { mockRecordTokenUsage } = vi.hoisted(() => ({
  mockRecordTokenUsage: vi.fn(),
}));
const { mockCreateLog } = vi.hoisted(() => ({
  mockCreateLog: vi.fn(),
}));
vi.mock('../../../db/queries/token-usage.js', () => ({
  recordTokenUsage: mockRecordTokenUsage,
}));
vi.mock('../../../db/queries/logs.js', () => ({
  createLog: mockCreateLog,
}));

function createMockCtx() {
  const mockProvider = { queryOne: vi.fn(), queryAll: vi.fn() };
  const mockDb = { provider: mockProvider, save: vi.fn() };
  return {
    verbose: false,
    config: {} as any,
    root: '/test',
    paths: {} as any,
    hiveSessions: [],
    counters: {
      nudged: 0,
      nudgeEnterPresses: 0,
      nudgeEnterRetries: 0,
      nudgeSubmitUnconfirmed: 0,
      autoProgressed: 0,
      messagesForwarded: 0,
      escalationsCreated: 0,
      escalationsResolved: 0,
      queuedPRCount: 0,
      reviewingPRCount: 0,
      handoffPromoted: 0,
      handoffAutoAssigned: 0,
      plannedAutoAssigned: 0,
      jiraSynced: 0,
      featureTestsSpawned: 0,
      auditorsSpawned: 0,
    },
    escalatedSessions: new Set<string | null>(),
    agentsBySessionName: new Map(),
    messagesToMarkRead: [],
    withDb: vi.fn(async (fn: any) => fn(mockDb, {})),
    _mockDb: mockDb,
  };
}

describe('token-capture', () => {
  beforeEach(() => {
    mockCaptureTmuxPane.mockReset();
    mockRecordTokenUsage.mockReset();
    mockCreateLog.mockReset();
    clearTokenDeduplicationState();
  });

  describe('captureAndPersistTokenUsage', () => {
    it('should return captured=false when pane output is empty', async () => {
      mockCaptureTmuxPane.mockResolvedValue('');
      const ctx = createMockCtx();

      const result = await captureAndPersistTokenUsage('test-session', ctx as any, 'agent-1');

      expect(result).toEqual({ captured: false, tokens: null, persisted: false });
      expect(mockRecordTokenUsage).not.toHaveBeenCalled();
    });

    it('should return tokens=null when no token info in output', async () => {
      mockCaptureTmuxPane.mockResolvedValue('Hello world\nSome random output');
      const ctx = createMockCtx();

      const result = await captureAndPersistTokenUsage('test-session', ctx as any, 'agent-1');

      expect(result).toEqual({ captured: true, tokens: null, persisted: false });
      expect(mockRecordTokenUsage).not.toHaveBeenCalled();
    });

    it('should capture and persist Claude Code token usage', async () => {
      mockCaptureTmuxPane.mockResolvedValue(
        'Total input tokens: 10,000\nTotal output tokens: 5,000\nTotal tokens: 15,000\nTotal cost: $1.23'
      );
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      const result = await captureAndPersistTokenUsage(
        'test-session',
        ctx as any,
        'agent-1',
        'story-1'
      );

      expect(result.captured).toBe(true);
      expect(result.tokens).toEqual({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        cost: 1.23,
      });
      expect(result.persisted).toBe(true);

      expect(mockRecordTokenUsage).toHaveBeenCalledWith(ctx._mockDb.provider, {
        agentId: 'agent-1',
        storyId: 'story-1',
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
      });

      expect(mockCreateLog).toHaveBeenCalledWith(ctx._mockDb.provider, {
        agentId: 'agent-1',
        storyId: 'story-1',
        eventType: 'STORY_PROGRESS_UPDATE',
        message: expect.stringContaining('input=10000'),
      });
    });

    it('should capture with large line count (500)', async () => {
      mockCaptureTmuxPane.mockResolvedValue('tokens: 5000');
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      await captureAndPersistTokenUsage('test-session', ctx as any, 'agent-1');

      expect(mockCaptureTmuxPane).toHaveBeenCalledWith('test-session', 500);
    });

    it('should handle tmux capture failure gracefully', async () => {
      mockCaptureTmuxPane.mockRejectedValue(new Error('tmux not found'));
      const ctx = createMockCtx();

      const result = await captureAndPersistTokenUsage('test-session', ctx as any, 'agent-1');

      expect(result).toEqual({ captured: false, tokens: null, persisted: false });
    });

    it('should handle db write failure gracefully', async () => {
      mockCaptureTmuxPane.mockResolvedValue('Total tokens: 15,000');
      mockRecordTokenUsage.mockRejectedValue(new Error('DB write failed'));
      const ctx = createMockCtx();
      ctx.withDb = vi.fn(async (_fn: any): Promise<any> => {
        throw new Error('DB write failed');
      });

      const result = await captureAndPersistTokenUsage('test-session', ctx as any, 'agent-1');

      expect(result).toEqual({ captured: false, tokens: null, persisted: false });
    });

    it('should pass null storyId when not provided', async () => {
      mockCaptureTmuxPane.mockResolvedValue('Total tokens: 1,000');
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      await captureAndPersistTokenUsage('test-session', ctx as any, 'agent-1');

      expect(mockRecordTokenUsage).toHaveBeenCalledWith(
        ctx._mockDb.provider,
        expect.objectContaining({ storyId: null })
      );
    });
  });

  describe('parseAndPersistTokenUsage', () => {
    it('should parse and persist from pre-captured output', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      const result = await parseAndPersistTokenUsage(
        'Input: 3,000 / Output: 2,000',
        ctx as any,
        'agent-2',
        'story-2'
      );

      expect(result.captured).toBe(true);
      expect(result.tokens).toEqual({
        inputTokens: 3000,
        outputTokens: 2000,
        totalTokens: 5000,
        cost: undefined,
      });
      expect(result.persisted).toBe(true);
    });

    it('should return tokens=null for output without token info', async () => {
      const ctx = createMockCtx();

      const result = await parseAndPersistTokenUsage(
        'Just some regular output',
        ctx as any,
        'agent-2'
      );

      expect(result).toEqual({ captured: true, tokens: null, persisted: false });
      expect(mockRecordTokenUsage).not.toHaveBeenCalled();
    });

    it('should include cost in log message when available', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      await parseAndPersistTokenUsage(
        'Total input tokens: 100\nTotal output tokens: 50\nTotal tokens: 150\nCost: $0.01',
        ctx as any,
        'agent-3'
      );

      expect(mockCreateLog).toHaveBeenCalledWith(
        ctx._mockDb.provider,
        expect.objectContaining({
          message: expect.stringContaining('cost=$0.01'),
        })
      );
    });
  });

  describe('parseAndPersistTokenUsageIfChanged', () => {
    it('should persist and return changed=true on first capture', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      const result = await parseAndPersistTokenUsageIfChanged(
        'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500',
        ctx as any,
        'agent-dedup-1',
        'story-1'
      );

      expect(result.captured).toBe(true);
      expect(result.persisted).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.tokens).toMatchObject({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });
      expect(mockRecordTokenUsage).toHaveBeenCalledTimes(1);
    });

    it('should not persist and return changed=false when token counts are unchanged', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();
      const output = 'Total input tokens: 2,000\nTotal output tokens: 1,000\nTotal tokens: 3,000';

      // First call — persists
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-dedup-2');

      mockRecordTokenUsage.mockReset();
      mockCreateLog.mockReset();

      // Second call with same counts — should skip
      const result = await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-dedup-2');

      expect(result.persisted).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.captured).toBe(true);
      expect(mockRecordTokenUsage).not.toHaveBeenCalled();
    });

    it('should persist again when token counts change', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      await parseAndPersistTokenUsageIfChanged(
        'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500',
        ctx as any,
        'agent-dedup-3'
      );

      mockRecordTokenUsage.mockReset();
      mockCreateLog.mockReset();

      // Different token counts
      const result = await parseAndPersistTokenUsageIfChanged(
        'Total input tokens: 2,000\nTotal output tokens: 1,000\nTotal tokens: 3,000',
        ctx as any,
        'agent-dedup-3'
      );

      expect(result.persisted).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockRecordTokenUsage).toHaveBeenCalledTimes(1);
    });

    it('should return captured=true tokens=null when output has no token data', async () => {
      const ctx = createMockCtx();

      const result = await parseAndPersistTokenUsageIfChanged(
        'No token information here',
        ctx as any,
        'agent-dedup-4'
      );

      expect(result.captured).toBe(true);
      expect(result.tokens).toBeNull();
      expect(result.persisted).toBe(false);
      expect(result.changed).toBe(false);
      expect(mockRecordTokenUsage).not.toHaveBeenCalled();
    });

    it('should track dedup state independently per agent', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();
      const output = 'Total input tokens: 1,000\nTotal output tokens: 500\nTotal tokens: 1,500';

      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-A');
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-B');

      // Both agents have same counts but are tracked separately — both should have persisted once
      expect(mockRecordTokenUsage).toHaveBeenCalledTimes(2);

      mockRecordTokenUsage.mockReset();

      // Second call for each — should not persist (already recorded)
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-A');
      await parseAndPersistTokenUsageIfChanged(output, ctx as any, 'agent-B');

      expect(mockRecordTokenUsage).not.toHaveBeenCalled();
    });

    it('should handle db write failure gracefully', async () => {
      const ctx = createMockCtx();
      ctx.withDb = vi.fn(async (_fn: any): Promise<any> => {
        throw new Error('DB write failed');
      });

      const result = await parseAndPersistTokenUsageIfChanged(
        'Total tokens: 5,000',
        ctx as any,
        'agent-dedup-5'
      );

      expect(result).toEqual({ captured: false, tokens: null, persisted: false, changed: false });
    });

    it('should use "Periodic token capture" in log message', async () => {
      mockRecordTokenUsage.mockResolvedValue({ id: 1 });
      mockCreateLog.mockResolvedValue(undefined);
      const ctx = createMockCtx();

      await parseAndPersistTokenUsageIfChanged(
        'Total input tokens: 100\nTotal output tokens: 50\nTotal tokens: 150',
        ctx as any,
        'agent-dedup-6'
      );

      expect(mockCreateLog).toHaveBeenCalledWith(
        ctx._mockDb.provider,
        expect.objectContaining({
          message: expect.stringContaining('Periodic token capture'),
        })
      );
    });
  });
});
