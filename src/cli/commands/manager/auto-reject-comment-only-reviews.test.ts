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

import { createLog } from '../../../db/queries/logs.js';
import { getPullRequestsByStatus, updatePullRequest } from '../../../db/queries/pull-requests.js';
import { updateStory } from '../../../db/queries/stories.js';
import { getAllTeams } from '../../../db/queries/teams.js';
import { getPullRequestComments, getPullRequestReviews } from '../../../git/github.js';
import { sendToTmuxSession } from '../../../tmux/manager.js';
import { agentStates } from './agent-monitoring.js';
import { autoRejectCommentOnlyReviews } from './index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockCtx(overrides: Partial<ManagerCheckContext> = {}): ManagerCheckContext {
  const mockDb = { db: {} as any, save: vi.fn(), close: vi.fn() };
  return {
    root: '/test/project',
    verbose: false,
    config: { manager: {} } as any,
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
    updated_at: new Date().toISOString(),
    reviewed_at: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('autoRejectCommentOnlyReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (agentStates as Map<string, any>).clear();
  });

  it('should return early when no PRs are in reviewing status', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([]);

    const ctx = makeMockCtx();
    await autoRejectCommentOnlyReviews(ctx);

    expect(getPullRequestReviews).not.toHaveBeenCalled();
    expect(getPullRequestComments).not.toHaveBeenCalled();
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should return early when reviewing PRs have no github_pr_number', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([
      makeReviewingPR({ github_pr_number: null }),
    ] as any);

    const ctx = makeMockCtx();
    await autoRejectCommentOnlyReviews(ctx);

    expect(getPullRequestReviews).not.toHaveBeenCalled();
  });

  it('should skip PRs where QA agent is not idle', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'working', session_name: 'hive-qa-test' } as any],
      ]),
    });

    // QA agent is working, not idle
    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.TOOL_RUNNING,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    await autoRejectCommentOnlyReviews(ctx);

    expect(getPullRequestReviews).not.toHaveBeenCalled();
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should skip PRs when QA has formal APPROVED review on GitHub', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
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

    vi.mocked(getPullRequestReviews).mockResolvedValue([
      { author: 'qa-bot', state: 'APPROVED', body: 'Looks good!' },
    ]);
    vi.mocked(getPullRequestComments).mockResolvedValue([]);

    await autoRejectCommentOnlyReviews(ctx);

    expect(getPullRequestReviews).toHaveBeenCalledWith('/test/project/repos/mini-marty', 42);
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should auto-reject when QA left CHANGES_REQUESTED review', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
      hiveSessions: [{ name: 'hive-senior-test' } as any],
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    vi.mocked(getPullRequestReviews).mockResolvedValue([
      { author: 'qa-bot', state: 'CHANGES_REQUESTED', body: 'Coverage below 80%.' },
    ]);
    vi.mocked(getPullRequestComments).mockResolvedValue([]);

    await autoRejectCommentOnlyReviews(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({
        status: 'rejected',
        reviewNotes: expect.stringContaining('Coverage below 80%'),
      })
    );
    expect(updateStory).toHaveBeenCalledWith(expect.anything(), 'STORY-001', {
      status: 'qa_failed',
    });
    expect(createLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: 'manager',
        eventType: 'PR_REJECTED',
        storyId: 'STORY-001',
        metadata: expect.objectContaining({ auto_rejected: true }),
      })
    );
  });

  it('should auto-reject when QA left substantive comments (>= 20 chars)', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
      hiveSessions: [{ name: 'hive-senior-test' } as any],
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    vi.mocked(getPullRequestReviews).mockResolvedValue([]);
    vi.mocked(getPullRequestComments).mockResolvedValue([
      {
        author: 'qa-agent',
        body: 'The test coverage thresholds are not met. Please add more tests.',
        createdAt: '2026-03-01T10:00:00Z',
      },
    ]);

    await autoRejectCommentOnlyReviews(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({
        status: 'rejected',
        reviewNotes: expect.stringContaining('test coverage thresholds'),
      })
    );
  });

  it('should ignore short comments (< 20 chars) and not reject', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
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

    vi.mocked(getPullRequestReviews).mockResolvedValue([]);
    vi.mocked(getPullRequestComments).mockResolvedValue([
      { author: 'user', body: 'LGTM', createdAt: '2026-03-01T10:00:00Z' },
    ]);

    await autoRejectCommentOnlyReviews(ctx);

    // Short comments should be filtered out → no rejection
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should skip bot "Looks good to me" comments under 100 chars', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
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

    vi.mocked(getPullRequestReviews).mockResolvedValue([]);
    vi.mocked(getPullRequestComments).mockResolvedValue([
      {
        author: 'ellipsis-bot',
        body: 'Looks good to me. No major issues.',
        createdAt: '2026-03-01T10:00:00Z',
      },
    ]);

    await autoRejectCommentOnlyReviews(ctx);

    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should gracefully skip PR when GitHub API call fails', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
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

    // Both API calls fail
    vi.mocked(getPullRequestReviews).mockRejectedValue(new Error('gh CLI not found'));
    vi.mocked(getPullRequestComments).mockRejectedValue(new Error('gh CLI not found'));

    await autoRejectCommentOnlyReviews(ctx);

    // Should not throw, should not reject
    expect(updatePullRequest).not.toHaveBeenCalled();
  });

  it('should notify developer agent via tmux after rejection', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
      hiveSessions: [{ name: 'hive-senior-test' } as any],
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    vi.mocked(getPullRequestReviews).mockResolvedValue([
      { author: 'qa', state: 'CHANGES_REQUESTED', body: 'Tests failing.' },
    ]);
    vi.mocked(getPullRequestComments).mockResolvedValue([]);

    await autoRejectCommentOnlyReviews(ctx);

    // Phase 4: Should notify the developer
    expect(sendToTmuxSession).toHaveBeenCalledWith(
      'hive-senior-test',
      expect.stringContaining('PR AUTO-REJECTED')
    );
  });

  it('should handle idle status from agent record even without agentStates entry', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
    });

    // No agentStates entry - but the agent record shows idle
    vi.mocked(getPullRequestReviews).mockResolvedValue([
      { author: 'qa', state: 'CHANGES_REQUESTED', body: 'Missing error handling in module.' },
    ]);
    vi.mocked(getPullRequestComments).mockResolvedValue([]);

    await autoRejectCommentOnlyReviews(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({ status: 'rejected' })
    );
  });

  it('should combine feedback from both reviews and comments in rejection reason', async () => {
    vi.mocked(getPullRequestsByStatus).mockReturnValue([makeReviewingPR()] as any);
    vi.mocked(getAllTeams).mockReturnValue([
      { id: 'team-1', repo_path: 'repos/mini-marty' },
    ] as any);

    const ctx = makeMockCtx({
      agentsBySessionName: new Map([
        ['hive-qa-test', { status: 'idle', session_name: 'hive-qa-test' } as any],
      ]),
      hiveSessions: [{ name: 'hive-senior-test' } as any],
    });

    (agentStates as Map<string, any>).set('hive-qa-test', {
      lastState: AgentState.IDLE_AT_PROMPT,
      lastStateChangeTime: Date.now(),
      lastNudgeTime: 0,
    });

    vi.mocked(getPullRequestReviews).mockResolvedValue([
      { author: 'qa', state: 'CHANGES_REQUESTED', body: 'Coverage below threshold.' },
    ]);
    vi.mocked(getPullRequestComments).mockResolvedValue([
      {
        author: 'qa',
        body: 'Also the vitest config needs updating for proper coverage.',
        createdAt: '2026-03-01T10:00:00Z',
      },
    ]);

    await autoRejectCommentOnlyReviews(ctx);

    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({
        reviewNotes: expect.stringContaining('Coverage below threshold'),
      })
    );
    expect(updatePullRequest).toHaveBeenCalledWith(
      expect.anything(),
      'pr-test-1',
      expect.objectContaining({
        reviewNotes: expect.stringContaining('vitest config needs updating'),
      })
    );
  });
});
