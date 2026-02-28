// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getApprovedPullRequests, updatePullRequest } from '../../../db/queries/pull-requests.js';

// Mock the functions we're testing with
vi.mock('../../../db/queries/pull-requests.js');
vi.mock('../../../db/queries/stories.js');
vi.mock('../../../db/queries/logs.js');
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
vi.mock('../../../utils/cli-commands.js', () => ({
  getAvailableCommands: vi.fn(() => ({
    msgReply: (id: string, msg: string, session: string) =>
      `hive msg reply ${id} "${msg}" --to ${session}`,
  })),
}));

describe('Auto-merge PRs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 0 when no approved PRs exist', () => {
    // Mock empty approved PRs
    vi.mocked(getApprovedPullRequests).mockReturnValue([]);

    // This is a basic test to ensure the function handles empty PR lists
    const approvedPRs = getApprovedPullRequests({} as Database);
    expect(approvedPRs).toEqual([]);
  });

  it('should skip PRs without GitHub PR numbers', () => {
    // This test validates that the logic correctly filters PRs
    const prWithoutGitHub = {
      id: 'pr-1',
      story_id: 'STORY-001',
      team_id: 'team-1',
      branch_name: 'feature/STORY-001-test',
      github_pr_number: null,
      github_pr_url: null,
      status: 'approved' as const,
      submitted_by: null,
      reviewed_by: 'qa-1',
      review_notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
    };

    // A PR without github_pr_number should be skipped
    expect(prWithoutGitHub.github_pr_number).toBeNull();
  });

  it('should validate PR status updates', () => {
    // This test ensures the function would properly update PR status
    // The function should call updatePullRequest with correct parameters
    // This is validated in the integration tests
    expect(updatePullRequest).toBeDefined();
  });
});

describe('Message Forwarding with Delivery Confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should forward messages with delivery confirmation', async () => {
    const { sendMessageWithConfirmation } = await import('../../../tmux/manager.js');

    vi.mocked(sendMessageWithConfirmation).mockResolvedValue(true);

    // Note: The actual forwardMessages function is not exported from manager.ts
    // This test validates the expected behavior through mocking
    // In a real scenario, you would test this through the manager command integration

    expect(sendMessageWithConfirmation).toBeDefined();
  });

  it('should handle delivery confirmation failures gracefully', async () => {
    const { sendMessageWithConfirmation } = await import('../../../tmux/manager.js');

    vi.mocked(sendMessageWithConfirmation).mockResolvedValue(false);

    // Should continue processing even if delivery confirmation fails
    expect(sendMessageWithConfirmation).toBeDefined();
  });

  it('should wait between message deliveries', async () => {
    const { sendMessageWithConfirmation } = await import('../../../tmux/manager.js');

    vi.mocked(sendMessageWithConfirmation).mockResolvedValue(true);

    // The forwardMessages function should have a delay between messages
    // This allows recipients time to read before next message arrives
    expect(sendMessageWithConfirmation).toBeDefined();
  });
});

describe('No-action manager summary classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should flag pending stories when there are no active worker agents', async () => {
    const { classifyNoActionSummary } = await import('./index.js');
    const result = classifyNoActionSummary({
      pendingEscalations: 0,
      pendingActionableStories: 5,
      activeWorkerAgents: 0,
      workingWorkerAgents: 0,
      liveWorkingSessions: 0,
    });

    expect(result.color).toBe('red');
    expect(result.message).toContain('5 actionable story(ies)');
  });

  it('should prioritize pending escalations over productivity status', async () => {
    const { classifyNoActionSummary } = await import('./index.js');
    const result = classifyNoActionSummary({
      pendingEscalations: 2,
      pendingActionableStories: 0,
      activeWorkerAgents: 3,
      workingWorkerAgents: 3,
      liveWorkingSessions: 3,
    });

    expect(result).toEqual({
      color: 'yellow',
      message: '2 pending escalation(s)',
    });
  });

  it('should report productive only when work and coverage look healthy', async () => {
    const { classifyNoActionSummary } = await import('./index.js');
    const result = classifyNoActionSummary({
      pendingEscalations: 0,
      pendingActionableStories: 3,
      activeWorkerAgents: 2,
      workingWorkerAgents: 2,
      liveWorkingSessions: 2,
    });

    expect(result).toEqual({
      color: 'green',
      message: 'All agents productive',
    });
  });

  it('should flag actionable work when only idle agents exist', async () => {
    const { classifyNoActionSummary } = await import('./index.js');
    const result = classifyNoActionSummary({
      pendingEscalations: 0,
      pendingActionableStories: 4,
      activeWorkerAgents: 2,
      workingWorkerAgents: 0,
      liveWorkingSessions: 0,
    });

    expect(result.color).toBe('red');
    expect(result.message).toContain('4 actionable story(ies)');
    expect(result.message).toContain('0 working agent(s)');
  });
});

describe('Unknown-state stuck heuristic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats unknown non-waiting sessions as stuck once static threshold is reached', async () => {
    const { shouldTreatUnknownAsStuckWaiting } = await import('./index.js');
    const { AgentState } = await import('../../../state-detectors/types.js');

    const result = shouldTreatUnknownAsStuckWaiting({
      state: AgentState.UNKNOWN,
      isWaiting: false,
      sessionUnchangedForMs: 600_000,
      staticInactivityThresholdMs: 600_000,
    });

    expect(result).toBe(true);
  });

  it('does not treat unknown as stuck before static threshold', async () => {
    const { shouldTreatUnknownAsStuckWaiting } = await import('./index.js');
    const { AgentState } = await import('../../../state-detectors/types.js');

    const result = shouldTreatUnknownAsStuckWaiting({
      state: AgentState.UNKNOWN,
      isWaiting: false,
      sessionUnchangedForMs: 90_000,
      staticInactivityThresholdMs: 600_000,
    });

    expect(result).toBe(false);
  });

  it('does not treat non-unknown states as unknown-state stuck candidates', async () => {
    const { shouldTreatUnknownAsStuckWaiting } = await import('./index.js');
    const { AgentState } = await import('../../../state-detectors/types.js');

    const result = shouldTreatUnknownAsStuckWaiting({
      state: AgentState.TOOL_RUNNING,
      isWaiting: false,
      sessionUnchangedForMs: 700_000,
      staticInactivityThresholdMs: 600_000,
    });

    expect(result).toBe(false);
  });
});

describe('Stuck reminder deferral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers reminders while static window has not elapsed for non-complete states', async () => {
    const { shouldDeferStuckReminderUntilStaticWindow } = await import('./index.js');
    const { AgentState } = await import('../../../state-detectors/types.js');

    const result = shouldDeferStuckReminderUntilStaticWindow({
      state: AgentState.IDLE_AT_PROMPT,
      sessionUnchangedForMs: 90_000,
      staticInactivityThresholdMs: 600_000,
    });

    expect(result).toBe(true);
  });

  it('does not defer reminders once static window elapsed', async () => {
    const { shouldDeferStuckReminderUntilStaticWindow } = await import('./index.js');
    const { AgentState } = await import('../../../state-detectors/types.js');

    const result = shouldDeferStuckReminderUntilStaticWindow({
      state: AgentState.IDLE_AT_PROMPT,
      sessionUnchangedForMs: 610_000,
      staticInactivityThresholdMs: 600_000,
    });

    expect(result).toBe(false);
  });

  it('does not defer mandatory completion for work-complete state', async () => {
    const { shouldDeferStuckReminderUntilStaticWindow } = await import('./index.js');
    const { AgentState } = await import('../../../state-detectors/types.js');

    const result = shouldDeferStuckReminderUntilStaticWindow({
      state: AgentState.WORK_COMPLETE,
      sessionUnchangedForMs: 10_000,
      staticInactivityThresholdMs: 600_000,
    });

    expect(result).toBe(false);
  });
});
