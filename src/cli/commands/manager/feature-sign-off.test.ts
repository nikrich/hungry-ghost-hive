// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRequirementsByStatus,
  mockUpdateRequirement,
  mockGetStoriesByRequirement,
  mockGetAllTeams,
  mockCreateLog,
} = vi.hoisted(() => ({
  mockGetRequirementsByStatus: vi.fn(),
  mockUpdateRequirement: vi.fn(),
  mockGetStoriesByRequirement: vi.fn(),
  mockGetAllTeams: vi.fn(),
  mockCreateLog: vi.fn(),
}));

vi.mock('../../../db/queries/requirements.js', () => ({
  getRequirementsByStatus: (...args: unknown[]) => mockGetRequirementsByStatus(...args),
  updateRequirement: (...args: unknown[]) => mockUpdateRequirement(...args),
  getRequirementById: vi.fn(),
  getAllRequirements: vi.fn(),
  getPendingRequirements: vi.fn(),
  createRequirement: vi.fn(),
  deleteRequirement: vi.fn(),
}));

vi.mock('../../../db/queries/stories.js', () => ({
  getStoriesByRequirement: (...args: unknown[]) => mockGetStoriesByRequirement(...args),
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
import type { RequirementRow, StoryRow, TeamRow } from '../../../db/client.js';
import { checkFeatureSignOff } from './feature-sign-off.js';
import type { ManagerCheckContext } from './types.js';

function makeCtx(overrides: Partial<ManagerCheckContext> = {}): ManagerCheckContext {
  return {
    root: '/test',
    verbose: false,
    config: {
      e2e_tests: { path: './e2e' },
    } as unknown as HiveConfig,
    paths: {} as ManagerCheckContext['paths'],
    db: { db: {} as never, save: vi.fn() } as unknown as ManagerCheckContext['db'],
    scheduler: {
      spawnFeatureTest: vi.fn().mockResolvedValue({ id: 'team-1-feature-test-1' }),
    } as unknown as ManagerCheckContext['scheduler'],
    hiveSessions: [],
    counters: {
      nudged: 0,
      autoProgressed: 0,
      messagesForwarded: 0,
      escalationsCreated: 0,
      escalationsResolved: 0,
      queuedPRCount: 0,
      handoffPromoted: 0,
      handoffAutoAssigned: 0,
      jiraSynced: 0,
      featureTestsSpawned: 0,
    },
    escalatedSessions: new Set(),
    agentsBySessionName: new Map(),
    messagesToMarkRead: [],
    ...overrides,
  };
}

function makeRequirement(overrides: Partial<RequirementRow> = {}): RequirementRow {
  return {
    id: 'REQ-TEST1234',
    title: 'Test requirement',
    description: 'Test desc',
    submitted_by: 'human',
    status: 'in_progress',
    godmode: 0,
    target_branch: 'feature/REQ-TEST1234',
    feature_branch: 'feature/REQ-TEST1234',
    jira_epic_key: null,
    jira_epic_id: null,
    external_epic_key: null,
    external_epic_id: null,
    external_provider: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeStory(overrides: Partial<StoryRow> = {}): StoryRow {
  return {
    id: 'STORY-TEST1',
    requirement_id: 'REQ-TEST1234',
    team_id: 'team-abc',
    title: 'Test story',
    description: 'Test story desc',
    acceptance_criteria: null,
    complexity: 3,
    status: 'merged',
    assigned_agent_id: null,
    branch_name: null,
    jira_issue_key: null,
    external_issue_key: null,
    external_provider: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as StoryRow;
}

function makeTeam(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    id: 'team-abc',
    repo_url: 'https://github.com/test/repo',
    repo_path: 'repos/team-abc',
    name: 'team-abc',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('checkFeatureSignOff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip when e2e_tests is not configured', async () => {
    const ctx = makeCtx({
      config: {} as unknown as HiveConfig,
    });

    await checkFeatureSignOff(ctx);

    expect(mockGetRequirementsByStatus).not.toHaveBeenCalled();
    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should skip when no in_progress requirements with feature branches exist', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([]);

    await checkFeatureSignOff(ctx);

    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should skip requirements without feature_branch set', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement({ feature_branch: null })]);

    await checkFeatureSignOff(ctx);

    expect(mockGetStoriesByRequirement).not.toHaveBeenCalled();
    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should skip when not all stories are merged', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement()]);
    mockGetStoriesByRequirement.mockReturnValue([
      makeStory({ id: 'STORY-1', status: 'merged' }),
      makeStory({ id: 'STORY-2', status: 'in_progress' }),
    ]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should skip requirements with no stories', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement()]);
    mockGetStoriesByRequirement.mockReturnValue([]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should spawn feature_test agent when all stories are merged', async () => {
    const ctx = makeCtx();
    const req = makeRequirement();
    mockGetRequirementsByStatus.mockReturnValue([req]);
    mockGetStoriesByRequirement.mockReturnValue([
      makeStory({ id: 'STORY-1', status: 'merged' }),
      makeStory({ id: 'STORY-2', status: 'merged' }),
    ]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    expect(mockUpdateRequirement).toHaveBeenCalledWith(expect.anything(), 'REQ-TEST1234', {
      status: 'sign_off',
    });
    expect(ctx.scheduler.spawnFeatureTest).toHaveBeenCalledWith(
      'team-abc',
      'team-abc',
      'repos/team-abc',
      {
        featureBranch: 'feature/REQ-TEST1234',
        requirementId: 'REQ-TEST1234',
        e2eTestsPath: './e2e',
      }
    );
    expect(ctx.counters.featureTestsSpawned).toBe(1);
    expect(ctx.db.save).toHaveBeenCalled();
  });

  it('should create log entries on successful spawn', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement()]);
    mockGetStoriesByRequirement.mockReturnValue([makeStory({ status: 'merged' })]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: 'team-1-feature-test-1',
        eventType: 'FEATURE_TEST_SPAWNED',
      })
    );
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: 'manager',
        eventType: 'FEATURE_SIGN_OFF_TRIGGERED',
      })
    );
  });

  it('should handle multiple requirements independently', async () => {
    const ctx = makeCtx();
    const req1 = makeRequirement({ id: 'REQ-AAA', feature_branch: 'feature/REQ-AAA' });
    const req2 = makeRequirement({ id: 'REQ-BBB', feature_branch: 'feature/REQ-BBB' });
    mockGetRequirementsByStatus.mockReturnValue([req1, req2]);
    mockGetStoriesByRequirement
      .mockReturnValueOnce([makeStory({ id: 'S-1', status: 'merged', requirement_id: 'REQ-AAA' })])
      .mockReturnValueOnce([
        makeStory({ id: 'S-2', status: 'merged', requirement_id: 'REQ-BBB' }),
        makeStory({ id: 'S-3', status: 'in_progress', requirement_id: 'REQ-BBB' }),
      ]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    // Only req1 should spawn (all merged); req2 has a non-merged story
    expect(ctx.counters.featureTestsSpawned).toBe(1);
    expect(mockUpdateRequirement).toHaveBeenCalledTimes(1);
    expect(mockUpdateRequirement).toHaveBeenCalledWith(expect.anything(), 'REQ-AAA', {
      status: 'sign_off',
    });
  });

  it('should skip when story has no team_id', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement()]);
    mockGetStoriesByRequirement.mockReturnValue([
      makeStory({ status: 'merged', team_id: null as unknown as string }),
    ]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should skip when team is not found', async () => {
    const ctx = makeCtx();
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement()]);
    mockGetStoriesByRequirement.mockReturnValue([
      makeStory({ status: 'merged', team_id: 'team-unknown' }),
    ]);
    mockGetAllTeams.mockReturnValue([makeTeam({ id: 'team-other' })]);

    await checkFeatureSignOff(ctx);

    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });

  it('should revert requirement status on spawn failure', async () => {
    const ctx = makeCtx({
      scheduler: {
        spawnFeatureTest: vi.fn().mockRejectedValue(new Error('spawn failed')),
      } as unknown as ManagerCheckContext['scheduler'],
    });
    mockGetRequirementsByStatus.mockReturnValue([makeRequirement()]);
    mockGetStoriesByRequirement.mockReturnValue([makeStory({ status: 'merged' })]);
    mockGetAllTeams.mockReturnValue([makeTeam()]);

    await checkFeatureSignOff(ctx);

    expect(mockUpdateRequirement).toHaveBeenCalledWith(expect.anything(), 'REQ-TEST1234', {
      status: 'sign_off',
    });
    expect(mockUpdateRequirement).toHaveBeenCalledWith(expect.anything(), 'REQ-TEST1234', {
      status: 'in_progress',
    });
    expect(ctx.counters.featureTestsSpawned).toBe(0);
  });
});
