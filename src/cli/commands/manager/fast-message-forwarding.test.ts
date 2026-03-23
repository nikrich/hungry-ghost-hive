// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../../../db/queries/agents.js';
import type { MessageRow } from '../../../db/queries/messages.js';

// Mock all external dependencies before importing the module under test
vi.mock('../../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(),
}));
vi.mock('../../../db/queries/messages.js', () => ({
  getAllPendingMessages: vi.fn(),
  markMessagesRead: vi.fn(),
}));
vi.mock('../../../db/queries/agents.js', () => ({
  getAllAgents: vi.fn(),
  getAgentById: vi.fn(),
}));
vi.mock('../../../tmux/manager.js', () => ({
  getHiveSessions: vi.fn(),
  getManagerSession: vi.fn(),
  captureTmuxPane: vi.fn(),
  isManagerRunning: vi.fn(),
  stopManager: vi.fn(),
  killTmuxSession: vi.fn(),
  isTmuxSessionRunning: vi.fn(),
}));
vi.mock('./agent-monitoring.js', () => ({
  forwardMessages: vi.fn(),
  agentStates: new Map(),
  detectAgentState: vi.fn(),
  enforceBypassMode: vi.fn(),
  getAgentSafetyMode: vi.fn(),
  handlePermissionPrompt: vi.fn(),
  handlePlanApproval: vi.fn(),
  nudgeAgent: vi.fn(),
  updateAgentStateTracking: vi.fn(),
}));

// Mock many other transitive imports to keep tests focused
vi.mock('../../../config/loader.js', () => ({ loadConfig: vi.fn() }));
vi.mock('../../../db/lock.js', () => ({ acquireLock: vi.fn() }));
vi.mock('../../../db/queries/escalations.js', () => ({
  getPendingEscalations: vi.fn(),
  updateEscalation: vi.fn(),
}));
vi.mock('../../../db/queries/logs.js', () => ({ createLog: vi.fn() }));
vi.mock('../../../db/queries/pull-requests.js', () => ({
  getApprovedPullRequests: vi.fn(),
  updatePullRequest: vi.fn(),
  backfillGithubPrNumbers: vi.fn(),
}));
vi.mock('../../../db/queries/stories.js', () => ({ getStoryById: vi.fn() }));
vi.mock('../../../orchestrator/scheduler.js', () => ({ Scheduler: vi.fn() }));
vi.mock('../../../cluster/runtime.js', () => ({
  ClusterRuntime: vi.fn(),
  fetchLocalClusterStatus: vi.fn(),
}));
vi.mock('../../../connectors/project-management/operations.js', () => ({
  syncFromProvider: vi.fn(),
}));
vi.mock('../../../utils/auto-merge.js', () => ({ autoMergeApprovedPRs: vi.fn() }));
vi.mock('../../../utils/instance.js', () => ({
  getManagerLockPath: vi.fn(),
  getTechLeadSessionName: vi.fn(),
}));
vi.mock('./auditor-lifecycle.js', () => ({ spawnAuditorIfNeeded: vi.fn() }));
vi.mock('./auto-assignment.js', () => ({ autoAssignPlannedStories: vi.fn() }));
vi.mock('./done-intelligence.js', () => ({ assessCompletionFromOutput: vi.fn() }));
vi.mock('./escalation-handler.js', () => ({ handleEscalationAndNudge: vi.fn() }));
vi.mock('./feature-sign-off.js', () => ({ checkFeatureSignOff: vi.fn() }));
vi.mock('./feature-test-result.js', () => ({ checkFeatureTestResult: vi.fn() }));
vi.mock('./handoff-recovery.js', () => ({ handleStalledPlanningHandoff: vi.fn() }));
vi.mock('./manager-utils.js', () => ({
  formatDuration: vi.fn(),
  getMaxStuckNudgesPerStory: vi.fn(),
  getScreenStaticInactivityThresholdMs: vi.fn(),
  sendManagerNudge: vi.fn(),
  verboseLog: vi.fn(),
  verboseLogCtx: vi.fn(),
}));
vi.mock('./orphaned-escalations.js', () => ({
  shouldAutoResolveOrphanedManagerEscalation: vi.fn(),
}));
vi.mock('./qa-review-handler.js', () => ({
  notifyQAOfQueuedPRs: vi.fn(),
  autoRejectCommentOnlyReviews: vi.fn(),
  handleRejectedPRs: vi.fn(),
}));
vi.mock('./pr-sync-orchestrator.js', () => ({
  closeStalePRs: vi.fn(),
  reconcileAgentsOnMergedStories: vi.fn(),
  recoverStaleReviewingPRs: vi.fn(),
  syncMergedPRs: vi.fn(),
  syncOpenPRs: vi.fn(),
}));
vi.mock('./spin-down.js', () => ({
  spinDownIdleAgents: vi.fn(),
  spinDownMergedAgents: vi.fn(),
}));
vi.mock('./stale-escalations.js', () => ({ findStaleSessionEscalations: vi.fn() }));
vi.mock('./stuck-story-helpers.js', () => ({
  applyHumanInterventionStateOverride: vi.fn(),
  clearHumanIntervention: vi.fn(),
  isClassifierTimeoutReason: vi.fn(),
  markClassifierTimeoutForHumanIntervention: vi.fn(),
  markDoneFalseForHumanIntervention: vi.fn(),
  screenStaticBySession: new Map(),
}));
vi.mock('./stuck-story-processor.js', () => ({
  nudgeQAFailedStories: vi.fn(),
  recoverUnassignedQAFailedStories: vi.fn(),
  nudgeStuckStories: vi.fn(),
  autoProgressDoneStory: vi.fn(),
}));
vi.mock('./tech-lead-lifecycle.js', () => ({ restartStaleTechLead: vi.fn() }));
vi.mock('./token-capture.js', () => ({
  parseAndPersistTokenUsage: vi.fn(),
  parseAndPersistTokenUsageIfChanged: vi.fn(),
}));

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'msg-1',
    from_session: 'hive-agent-a',
    to_session: 'hive-agent-b',
    subject: 'hello',
    body: 'world',
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  } as MessageRow;
}

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-b',
    tmux_session: 'hive-agent-b',
    cli_tool: 'claude',
    current_story_id: null,
    ...overrides,
  } as AgentRow;
}

describe('forwardPendingMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits early when there are no pending messages', async () => {
    const { withHiveContext } = await import('../../../utils/with-hive-context.js');
    const { getAllPendingMessages } = await import('../../../db/queries/messages.js');
    const { forwardMessages } = await import('./agent-monitoring.js');

    const mockDb = { provider: {}, save: vi.fn() };
    const mockPaths = { hiveDir: '/hive' };

    vi.mocked(withHiveContext).mockImplementation(async fn =>
      fn({ db: mockDb, paths: mockPaths } as never)
    );
    vi.mocked(getAllPendingMessages).mockResolvedValue([]);

    const { forwardPendingMessages } = await import('./index.js');
    await forwardPendingMessages(false);

    expect(forwardMessages).not.toHaveBeenCalled();
  });

  it('forwards messages to active sessions and marks them as read', async () => {
    const { withHiveContext } = await import('../../../utils/with-hive-context.js');
    const { getAllPendingMessages, markMessagesRead } =
      await import('../../../db/queries/messages.js');
    const { getAllAgents } = await import('../../../db/queries/agents.js');
    const { getHiveSessions, getManagerSession } = await import('../../../tmux/manager.js');
    const { forwardMessages } = await import('./agent-monitoring.js');

    const mockDb = { provider: {}, save: vi.fn() };
    const mockPaths = { hiveDir: '/hive' };
    const msg = makeMessage();
    const agent = makeAgent();

    vi.mocked(withHiveContext).mockImplementation(async fn =>
      fn({ db: mockDb, paths: mockPaths } as never)
    );
    vi.mocked(getAllPendingMessages).mockResolvedValue([msg]);
    vi.mocked(getAllAgents).mockResolvedValue([agent]);
    vi.mocked(getHiveSessions).mockResolvedValue([{ name: 'hive-agent-b' }] as never);
    vi.mocked(getManagerSession).mockReturnValue('hive-manager');
    vi.mocked(forwardMessages).mockResolvedValue(undefined);

    const { forwardPendingMessages } = await import('./index.js');
    await forwardPendingMessages(false);

    expect(forwardMessages).toHaveBeenCalledWith('hive-agent-b', [msg], 'claude');
    expect(markMessagesRead).toHaveBeenCalledWith(mockDb.provider, ['msg-1']);
    expect(mockDb.save).toHaveBeenCalled();
  });

  it('skips the manager session', async () => {
    const { withHiveContext } = await import('../../../utils/with-hive-context.js');
    const { getAllPendingMessages, markMessagesRead } =
      await import('../../../db/queries/messages.js');
    const { getAllAgents } = await import('../../../db/queries/agents.js');
    const { getHiveSessions, getManagerSession } = await import('../../../tmux/manager.js');
    const { forwardMessages } = await import('./agent-monitoring.js');

    const mockDb = { provider: {}, save: vi.fn() };
    const mockPaths = { hiveDir: '/hive' };
    const msg = makeMessage({ to_session: 'hive-manager' });

    vi.mocked(withHiveContext).mockImplementation(async fn =>
      fn({ db: mockDb, paths: mockPaths } as never)
    );
    vi.mocked(getAllPendingMessages).mockResolvedValue([msg]);
    vi.mocked(getAllAgents).mockResolvedValue([]);
    vi.mocked(getHiveSessions).mockResolvedValue([{ name: 'hive-manager' }] as never);
    vi.mocked(getManagerSession).mockReturnValue('hive-manager');

    const { forwardPendingMessages } = await import('./index.js');
    await forwardPendingMessages(false);

    expect(forwardMessages).not.toHaveBeenCalled();
    expect(markMessagesRead).not.toHaveBeenCalled();
  });

  it('skips sessions not registered in the DB', async () => {
    const { withHiveContext } = await import('../../../utils/with-hive-context.js');
    const { getAllPendingMessages, markMessagesRead } =
      await import('../../../db/queries/messages.js');
    const { getAllAgents } = await import('../../../db/queries/agents.js');
    const { getHiveSessions, getManagerSession } = await import('../../../tmux/manager.js');
    const { forwardMessages } = await import('./agent-monitoring.js');

    const mockDb = { provider: {}, save: vi.fn() };
    const mockPaths = { hiveDir: '/hive' };
    const msg = makeMessage({ to_session: 'hive-unknown' });

    vi.mocked(withHiveContext).mockImplementation(async fn =>
      fn({ db: mockDb, paths: mockPaths } as never)
    );
    vi.mocked(getAllPendingMessages).mockResolvedValue([msg]);
    vi.mocked(getAllAgents).mockResolvedValue([]); // no agents registered
    vi.mocked(getHiveSessions).mockResolvedValue([{ name: 'hive-unknown' }] as never);
    vi.mocked(getManagerSession).mockReturnValue('hive-manager');

    const { forwardPendingMessages } = await import('./index.js');
    await forwardPendingMessages(false);

    expect(forwardMessages).not.toHaveBeenCalled();
    expect(markMessagesRead).not.toHaveBeenCalled();
  });

  it('handles errors without throwing', async () => {
    const { withHiveContext } = await import('../../../utils/with-hive-context.js');

    vi.mocked(withHiveContext).mockRejectedValue(new Error('DB unavailable'));

    const { forwardPendingMessages } = await import('./index.js');
    // Should not throw
    await expect(forwardPendingMessages(false)).resolves.toBeUndefined();
  });

  it('uses hive-<id> session name pattern to resolve agents', async () => {
    const { withHiveContext } = await import('../../../utils/with-hive-context.js');
    const { getAllPendingMessages, markMessagesRead } =
      await import('../../../db/queries/messages.js');
    const { getAllAgents } = await import('../../../db/queries/agents.js');
    const { getHiveSessions, getManagerSession } = await import('../../../tmux/manager.js');
    const { forwardMessages } = await import('./agent-monitoring.js');

    const mockDb = { provider: {}, save: vi.fn() };
    const mockPaths = { hiveDir: '/hive' };
    // Agent with no tmux_session set — should still be found via hive-<id> pattern
    const agent = makeAgent({ id: 'xyz', tmux_session: null });
    const msg = makeMessage({ to_session: 'hive-xyz' });

    vi.mocked(withHiveContext).mockImplementation(async fn =>
      fn({ db: mockDb, paths: mockPaths } as never)
    );
    vi.mocked(getAllPendingMessages).mockResolvedValue([msg]);
    vi.mocked(getAllAgents).mockResolvedValue([agent]);
    vi.mocked(getHiveSessions).mockResolvedValue([{ name: 'hive-xyz' }] as never);
    vi.mocked(getManagerSession).mockReturnValue('hive-manager');
    vi.mocked(forwardMessages).mockResolvedValue(undefined);

    const { forwardPendingMessages } = await import('./index.js');
    await forwardPendingMessages(false);

    expect(forwardMessages).toHaveBeenCalledWith('hive-xyz', [msg], 'claude');
    expect(markMessagesRead).toHaveBeenCalledWith(mockDb.provider, ['msg-1']);
  });
});
