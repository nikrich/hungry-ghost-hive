// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAgentsByType, mockGetAllTeams, mockCreateLog } = vi.hoisted(() => ({
  mockGetAgentsByType: vi.fn(),
  mockGetAllTeams: vi.fn(),
  mockCreateLog: vi.fn(),
}));

vi.mock('../../../db/queries/agents.js', () => ({
  getAgentsByType: (...args: unknown[]) => mockGetAgentsByType(...args),
  getAllAgents: vi.fn(),
  getAgentById: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getAgentsByTeam: vi.fn(),
  getAgentsByStatus: vi.fn(),
  getActiveAgents: vi.fn(),
  getTechLead: vi.fn(),
  getAgentByTmuxSession: vi.fn(),
  terminateAgent: vi.fn(),
}));

vi.mock('../../../db/queries/teams.js', () => ({
  getAllTeams: (...args: unknown[]) => mockGetAllTeams(...args),
  getTeamById: vi.fn(),
  getTeamByName: vi.fn(),
  createTeam: vi.fn(),
  deleteTeam: vi.fn(),
}));

vi.mock('../../../db/queries/logs.js', () => ({
  createLog: (...args: unknown[]) => mockCreateLog(...args),
  getLogsByAgent: vi.fn(),
  getLogsByStory: vi.fn(),
  getLogsByEventType: vi.fn(),
  getRecentLogs: vi.fn(),
  getLogById: vi.fn(),
}));

import type { HiveConfig } from '../../../config/schema.js';
import {
  getLastAuditorSpawnTime,
  resetAuditorLifecycleState,
  spawnAuditorIfNeeded,
} from './auditor-lifecycle.js';
import type { ManagerCheckContext } from './types.js';

function makeCtx(
  overrides: Partial<ManagerCheckContext> = {},
  schedulerOverrides: Record<string, unknown> = {}
): ManagerCheckContext {
  const mockDb = { db: {} as never, save: vi.fn(), close: vi.fn(), runMigrations: vi.fn() };
  const mockScheduler = {
    spawnAuditor: vi.fn().mockResolvedValue({ id: 'auditor-abc123' }),
    ...schedulerOverrides,
  };

  const withDb: ManagerCheckContext['withDb'] = async fn => {
    return fn(mockDb as never, mockScheduler as never);
  };

  return {
    root: '/test',
    verbose: false,
    config: {
      manager: {
        auditor_enabled: true,
        auditor_interval_ms: 300000,
      },
    } as unknown as HiveConfig,
    paths: {} as ManagerCheckContext['paths'],
    withDb,
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
    escalatedSessions: new Set(),
    agentsBySessionName: new Map(),
    messagesToMarkRead: [],
    ...overrides,
  };
}

describe('spawnAuditorIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditorLifecycleState();
  });

  it('returns false when auditor_enabled is false', async () => {
    const ctx = makeCtx({
      config: {
        manager: { auditor_enabled: false, auditor_interval_ms: 300000 },
      } as unknown as HiveConfig,
    });

    const result = await spawnAuditorIfNeeded(ctx);
    expect(result).toBe(false);
    expect(ctx.counters.auditorsSpawned).toBe(0);
  });

  it('spawns auditor when interval elapsed and no active auditor', async () => {
    mockGetAgentsByType.mockReturnValue([]);
    mockGetAllTeams.mockReturnValue([{ id: 'team-1', name: 'alpha', repo_path: '/repo' }]);

    const ctx = makeCtx();
    const result = await spawnAuditorIfNeeded(ctx);

    expect(result).toBe(true);
    expect(ctx.counters.auditorsSpawned).toBe(1);
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'AGENT_SPAWNED',
      })
    );
  });

  it('skips spawn when interval has not elapsed', async () => {
    mockGetAgentsByType.mockReturnValue([]);
    mockGetAllTeams.mockReturnValue([{ id: 'team-1', name: 'alpha', repo_path: '/repo' }]);

    const ctx = makeCtx();

    // First call spawns
    await spawnAuditorIfNeeded(ctx);
    expect(ctx.counters.auditorsSpawned).toBe(1);

    // Second call within interval should skip
    const result = await spawnAuditorIfNeeded(ctx);
    expect(result).toBe(true);
    expect(ctx.counters.auditorsSpawned).toBe(1); // unchanged
  });

  it('skips spawn when an active auditor is running', async () => {
    mockGetAgentsByType.mockReturnValue([
      { id: 'auditor-existing', type: 'auditor', status: 'working' },
    ]);

    // Force the interval to have elapsed
    resetAuditorLifecycleState();

    const ctx = makeCtx();
    const result = await spawnAuditorIfNeeded(ctx);

    expect(result).toBe(true);
    expect(ctx.counters.auditorsSpawned).toBe(0);
  });

  it('skips spawn when no teams exist', async () => {
    mockGetAgentsByType.mockReturnValue([]);
    mockGetAllTeams.mockReturnValue([]);

    const ctx = makeCtx();
    const result = await spawnAuditorIfNeeded(ctx);

    expect(result).toBe(true);
    expect(ctx.counters.auditorsSpawned).toBe(0);
  });

  it('handles spawn errors gracefully', async () => {
    mockGetAgentsByType.mockReturnValue([]);
    mockGetAllTeams.mockReturnValue([{ id: 'team-1', name: 'alpha', repo_path: '/repo' }]);

    const ctx = makeCtx(
      {},
      {
        spawnAuditor: vi.fn().mockRejectedValue(new Error('spawn failed')),
      }
    );

    const result = await spawnAuditorIfNeeded(ctx);
    expect(result).toBe(true);
    expect(ctx.counters.auditorsSpawned).toBe(0);
  });

  it('does not count terminated auditors as active', async () => {
    mockGetAgentsByType.mockReturnValue([
      { id: 'auditor-old', type: 'auditor', status: 'terminated' },
    ]);
    mockGetAllTeams.mockReturnValue([{ id: 'team-1', name: 'alpha', repo_path: '/repo' }]);

    const ctx = makeCtx();
    const result = await spawnAuditorIfNeeded(ctx);

    expect(result).toBe(true);
    expect(ctx.counters.auditorsSpawned).toBe(1);
  });

  it('updates lastAuditorSpawnTime after successful spawn', async () => {
    mockGetAgentsByType.mockReturnValue([]);
    mockGetAllTeams.mockReturnValue([{ id: 'team-1', name: 'alpha', repo_path: '/repo' }]);

    expect(getLastAuditorSpawnTime()).toBe(0);

    const ctx = makeCtx();
    await spawnAuditorIfNeeded(ctx);

    expect(getLastAuditorSpawnTime()).toBeGreaterThan(0);
  });
});
