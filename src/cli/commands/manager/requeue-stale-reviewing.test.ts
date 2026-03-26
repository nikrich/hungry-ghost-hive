// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import type { ManagerCheckContext } from './types.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../db/queries/pull-requests.js', () => ({
  getPullRequestsByStatus: vi.fn(() => []),
  updatePullRequest: vi.fn(),
  getApprovedPullRequests: vi.fn(() => []),
  backfillGithubPrNumbers: vi.fn(),
  createPullRequest: vi.fn(),
  getMergeQueue: vi.fn(() => []),
  getOpenPullRequestsByStory: vi.fn(() => []),
}));

vi.mock('../../../db/queries/stories.js', () => ({
  getStoriesByStatus: vi.fn(() => []),
  getStoryById: vi.fn(),
  updateStory: vi.fn(),
}));

vi.mock('../../../db/queries/logs.js', () => ({
  createLog: vi.fn(),
  getLogsByEventType: vi.fn(() => []),
}));

vi.mock('../../../db/queries/teams.js', () => ({
  getAllTeams: vi.fn(() => []),
}));

vi.mock('../../../db/client.js', () => ({
  queryAll: vi.fn(() => []),
  queryOne: vi.fn(),
  withTransaction: vi.fn((_db: unknown, fn: () => void, saveFn: () => void) => {
    fn();
    saveFn();
  }),
}));

vi.mock('../../../git/github.js', () => ({
  getPullRequestReviews: vi.fn(() => Promise.resolve([])),
  getPullRequestComments: vi.fn(() => Promise.resolve([])),
  isGitHubAuthenticated: vi.fn(),
  isGitHubCLIAvailable: vi.fn(),
}));

vi.mock('../../../tmux/manager.js', () => ({
  sendMessageWithConfirmation: vi.fn(),
  getHiveSessions: vi.fn(),
  sendToTmuxSession: vi.fn(),
  sendEnterToTmuxSession: vi.fn(),
  captureTmuxPane: vi.fn(),
  isManagerRunning: vi.fn(),
  stopManager: vi.fn(),
  killTmuxSession: vi.fn(),
}));

vi.mock('./agent-monitoring.js', () => ({
  agentStates: new Map(),
  createManagerNudgeEnvelope: vi.fn((msg: string) => ({
    text: `[START]${msg}[END]`,
    nudgeId: 'nudge-123',
  })),
  submitManagerNudgeWithVerification: vi.fn(() =>
    Promise.resolve({ confirmed: true, enterPresses: 1, retryEnters: 0, checks: 1 })
  ),
  detectAgentState: vi.fn(),
  enforceBypassMode: vi.fn(),
  forwardMessages: vi.fn(),
  getAgentSafetyMode: vi.fn(),
  handlePermissionPrompt: vi.fn(),
  handlePlanApproval: vi.fn(),
  nudgeAgent: vi.fn(),
  updateAgentStateTracking: vi.fn(),
}));

vi.mock('./auto-assignment.js', () => ({
  autoAssignPlannedStories: vi.fn(),
}));

vi.mock('./done-intelligence.js', () => ({
  assessCompletionFromOutput: vi.fn(),
}));

vi.mock('./escalation-handler.js', () => ({
  handleEscalationAndNudge: vi.fn(),
}));

vi.mock('./feature-sign-off.js', () => ({
  checkFeatureSignOff: vi.fn(),
}));

vi.mock('./feature-test-result.js', () => ({
  checkFeatureTestResult: vi.fn(),
}));

vi.mock('./handoff-recovery.js', () => ({
  handleStalledPlanningHandoff: vi.fn(),
}));

vi.mock('./merged-story-cleanup.js', () => ({
  cleanupAgentsReferencingMergedStory: vi.fn(),
}));

vi.mock('./orphaned-escalations.js', () => ({
  shouldAutoResolveOrphanedManagerEscalation: vi.fn(),
}));

vi.mock('./session-resolution.js', () => ({
  findSessionForAgent: vi.fn(),
}));

vi.mock('./spin-down.js', () => ({
  spinDownIdleAgents: vi.fn(),
  spinDownMergedAgents: vi.fn(),
}));

vi.mock('./stale-escalations.js', () => ({
  findStaleSessionEscalations: vi.fn(() => []),
}));

vi.mock('../../../utils/auto-merge.js', () => ({
  autoMergeApprovedPRs: vi.fn(),
}));

vi.mock('../../../utils/cli-commands.js', () => ({
  getAvailableCommands: vi.fn(() => ({})),
}));

vi.mock('../../../utils/pr-sync.js', () => ({
  fetchOpenGitHubPRs: vi.fn(),
  getExistingPRIdentifiers: vi.fn(),
  ghRepoSlug: vi.fn(),
}));

vi.mock('../../../utils/story-id.js', () => ({
  extractStoryIdFromBranch: vi.fn(),
}));

vi.mock('../../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(),
  withHiveRoot: vi.fn(),
}));

vi.mock('../../../utils/paths.js', () => ({
  findHiveRoot: vi.fn(),
  getHivePaths: vi.fn(() => ({ hiveDir: '/tmp/.hive' })),
}));

vi.mock('../../../orchestrator/scheduler.js', () => ({
  Scheduler: vi.fn().mockImplementation(() => ({})),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { createLog, getLogsByEventType } from '../../../db/queries/logs.js';
import { getPullRequestsByStatus, updatePullRequest } from '../../../db/queries/pull-requests.js';
import { updateStory } from '../../../db/queries/stories.js';
import { agentStates } from './agent-monitoring.js';
import { requeueStaleReviewingPRs } from './qa-review-handler.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockCtx(overrides: Partial<ManagerCheckContext> = {}): ManagerCheckContext {
  const mockDb = {
    db: {} as any,
    provider: { withTransaction: vi.fn(async (fn: () => unknown) => fn()) },
    save: vi.fn(),
    close: vi.fn(),
  };
  return {
    root: '/test/project',
    verbose: false,
    config: {
      manager: {},
      merge_queue: { max_age_hours: 1, reviewing_timeout_ms: 600000 },
    } as any,
    paths: { hiveDir: '/test/project/.hive' } as any,
    withDb: vi.fn(async (fn: any) => fn(mockDb, {})),
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

function makeReviewingPR(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pr-test-1',
    story_id: 'STORY-001',
    team_id: 'team-1',
    branch_name: 'feature/STORY-001-test',
    github_pr_number: 42,
    github_pr_url: 'https://github.com/test/repo/pull/42',
    status: 'reviewing' as const,
    submitted_by: 'hive-senior-test',
    reviewed_by: 'hive-qa-test',
    review_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 min ago (past timeout)
    reviewed_at: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('requeueStaleReviewingPRs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (agentStates as Map<string, any>).clear();
  });

  it('should return early when no PRs are in reviewing status', async () => {
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([]);

    const ctx = makeMockCtx();
    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  it('should requeue a PR stuck in reviewing with idle QA agent past timeout', async () => {
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([makeReviewingPR()] as any);
    vi.mocked(getLogsByEventType).mockResolvedValue([]);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({
        status: 'queued',
        reviewedBy: null,
      })
    );
    expect(createLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: 'manager',
        eventType: 'PR_REVIEW_TIMEOUT',
        storyId: 'STORY-001',
        metadata: expect.objectContaining({ pr_id: 'pr-test-1', action: 'requeued' }),
      })
    );
  });

  it('should NOT requeue PRs where QA agent is not idle', async () => {
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([makeReviewingPR()] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'working', session_name: 'hive-qa-test' } as any],
      ]),
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.TOOL_RUNNING,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  it('should NOT requeue PRs under the timeout threshold', async () => {
    // updated_at is recent (1 minute ago, well under 10 minute timeout)
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([
      makeReviewingPR({ updated_at: new Date(Date.now() - 60 * 1000).toISOString() }),
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  it('should auto-reject after 3 timeouts instead of requeuing', async () => {
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([makeReviewingPR()] as any);

    // Simulate 3 previous timeout logs for this PR
    vi.mocked(getLogsByEventType).mockResolvedValue([
      { id: 1, agent_id: 'manager', story_id: 'STORY-001', event_type: 'PR_REVIEW_TIMEOUT', status: null, message: '', metadata: JSON.stringify({ pr_id: 'pr-test-1', action: 'requeued' }), timestamp: new Date().toISOString() },
      { id: 2, agent_id: 'manager', story_id: 'STORY-001', event_type: 'PR_REVIEW_TIMEOUT', status: null, message: '', metadata: JSON.stringify({ pr_id: 'pr-test-1', action: 'requeued' }), timestamp: new Date().toISOString() },
      { id: 3, agent_id: 'manager', story_id: 'STORY-001', event_type: 'PR_REVIEW_TIMEOUT', status: null, message: '', metadata: JSON.stringify({ pr_id: 'pr-test-1', action: 'requeued' }), timestamp: new Date().toISOString() },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({
        status: 'rejected',
        reviewNotes: expect.stringContaining('timed out'),
      })
    );
    expect(updateStory).toHaveBeenCalledWith(expect.anything(), 'STORY-001', {
      status: 'qa_failed',
    });
    expect(createLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'PR_REVIEW_TIMEOUT',
        metadata: expect.objectContaining({ action: 'rejected', timeout_count: 4 }),
      })
    );
  });

  it('should skip PRs without a reviewed_by assignment', async () => {
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([
      makeReviewingPR({ reviewed_by: null }),
    ] as any);

    const ctx = makeMockCtx();
    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should detect idle from agent record even without agentStates entry', async () => {
    vi.mocked(getPullRequestsByStatus).mockResolvedValue([makeReviewingPR()] as any);
    vi.mocked(getLogsByEventType).mockResolvedValue([]);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
    });

    // No agentStates entry, but agent record shows idle
    await requeueStaleReviewingPRs(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({ status: 'queued', reviewedBy: null })
    );
  });
});
