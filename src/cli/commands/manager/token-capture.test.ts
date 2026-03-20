// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAndPersistTokenUsage, parseAndPersistTokenUsage } from './token-capture.js';

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
        eventType: 'TOKEN_USAGE_CAPTURED',
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
      ctx.withDb = vi.fn(async () => {
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
});
