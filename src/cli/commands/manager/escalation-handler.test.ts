// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentState } from '../../../state-detectors/types.js';
import {
  buildHumanApprovalReason,
  buildInterruptionRecoveryPrompt,
  buildRateLimitRecoveryPrompt,
  handleEscalationAndNudge,
} from './escalation-handler.js';

vi.mock('../../../db/queries/escalations.js');
vi.mock('../../../db/queries/logs.js');
vi.mock('./agent-monitoring.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./agent-monitoring.js')>();
  return {
    ...actual,
    sendToTmuxSession: vi.fn(),
    withManagerNudgeEnvelope: vi.fn((msg: string) => msg),
    buildAutoRecoveryReminder: vi.fn(() => 'reminder'),
  };
});
vi.mock('../../../tmux/manager.js', () => ({
  sendEnterToTmuxSession: vi.fn(),
  killTmuxSession: vi.fn(),
  captureTmuxPane: vi.fn(),
  getHiveSessions: vi.fn(),
  sendMessageWithConfirmation: vi.fn(),
  sendToTmuxSession: vi.fn(),
  autoApprovePermission: vi.fn(),
  forceBypassMode: vi.fn(),
  isManagerRunning: vi.fn(),
  stopManager: vi.fn(),
}));

describe('buildHumanApprovalReason', () => {
  it('should include option-2 guidance for codex permission menus', () => {
    const output = `
Would you like to run the following command?

$ git restore --worktree

1. Yes, proceed (y)
2. Yes, and don't ask again for commands that start with \`git restore\` (p)
3. No, and tell Codex what to do differently (esc)
`;

    const reason = buildHumanApprovalReason(
      'hive-junior-team-1',
      'Permission required',
      AgentState.PERMISSION_REQUIRED,
      'codex',
      output
    );

    expect(reason).toContain('Approval required (codex)');
    expect(reason).toContain('Action: Select option 2');
    expect(reason).toContain('`git restore`');
  });

  it('should include selection guidance for waiting-selection state', () => {
    const reason = buildHumanApprovalReason(
      'hive-qa-team-1',
      'Awaiting user selection',
      AgentState.AWAITING_SELECTION,
      'claude',
      'Select an option'
    );

    expect(reason).toContain('Approval required (claude)');
    expect(reason).toContain('Action: Choose one of the presented options');
  });

  it('should include answer guidance for question state', () => {
    const reason = buildHumanApprovalReason(
      'hive-intermediate-team-1',
      'Asking a question - needs response',
      AgentState.ASKING_QUESTION,
      'gemini',
      'Do you want to continue?'
    );

    expect(reason).toContain('Approval required (gemini)');
    expect(reason).toContain('Action: Answer the question in the agent session');
  });

  it('should include recovery guidance for declined state', () => {
    const reason = buildHumanApprovalReason(
      'hive-senior-team-1',
      'User declined - blocked',
      AgentState.USER_DECLINED,
      'claude',
      'User chose not to proceed'
    );

    expect(reason).toContain('Approval required (claude)');
    expect(reason).toContain('Action: Agent is blocked after a declined prompt');
  });
});

describe('buildInterruptionRecoveryPrompt', () => {
  it('includes story-specific resume and submit instructions', () => {
    const prompt = buildInterruptionRecoveryPrompt('hive-intermediate-grigora', 'STORY-003');

    expect(prompt).toContain('Continue STORY-003 from your last checkpoint');
    expect(prompt).toContain(
      'hive pr submit -b <branch> -s STORY-003 --from hive-intermediate-grigora'
    );
    expect(prompt).toContain('Do not reply with a status update');
  });

  it('falls back to generic story placeholder when story id is missing', () => {
    const prompt = buildInterruptionRecoveryPrompt('hive-junior-grigora');

    expect(prompt).toContain('Continue your assigned story from your last checkpoint');
    expect(prompt).toContain('hive pr submit -b <branch> -s <story-id> --from hive-junior-grigora');
  });
});

describe('buildRateLimitRecoveryPrompt', () => {
  it('includes sleep/pause and story-specific submit instructions', () => {
    const prompt = buildRateLimitRecoveryPrompt('hive-intermediate-grigora-8', 120000, 'STORY-003');

    expect(prompt).toContain('rate limit detected (HTTP 429)');
    expect(prompt).toContain('Run: sleep 120');
    expect(prompt).toContain(
      'hive pr submit -b <branch> -s STORY-003 --from hive-intermediate-grigora-8'
    );
  });

  it('falls back to generic story placeholder when story id is missing', () => {
    const prompt = buildRateLimitRecoveryPrompt('hive-junior-grigora-11', 90000);

    expect(prompt).toContain('continue your assigned story from your last checkpoint');
    expect(prompt).toContain(
      'hive pr submit -b <branch> -s <story-id> --from hive-junior-grigora-11'
    );
  });
});

describe('handleEscalationAndNudge interruption recovery progression', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { agentStates } = await import('./agent-monitoring.js');
    agentStates.clear();
    const { getRecentEscalationsForAgent, getActiveEscalationsForAgent } =
      await import('../../../db/queries/escalations.js');
    vi.mocked(getRecentEscalationsForAgent).mockReturnValue([]);
    vi.mocked(getActiveEscalationsForAgent).mockReturnValue([]);
  });

  function makeCtx() {
    const dbInstance = {} as Database;
    return {
      ctx: {
        verbose: false,
        escalatedSessions: new Set<string>(),
        counters: { nudged: 0, escalationsCreated: 0, escalationsResolved: 0 },
        config: { manager: { nudge_cooldown_ms: 60000 } },
        withDb: async (fn: (db: { db: Database; save: () => void }) => Promise<unknown>) =>
          fn({ db: dbInstance, save: vi.fn() }),
      },
    };
  }

  it('keeps interruption attempts across idle waiting checks so recovery can escalate', async () => {
    const { sendToTmuxSession } = await import('./agent-monitoring.js');
    const mockedSendToTmux = vi.mocked(sendToTmuxSession);
    const { ctx } = makeCtx();
    const agent = {
      id: 'senior-keep-attempts',
      current_story_id: 'STORY-KEEP-1',
    } as Parameters<typeof handleEscalationAndNudge>[2] & {};
    const interruptionOutput =
      '■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit `/feedback` to report the issue.';

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-keep-attempts',
      agent,
      { state: AgentState.USER_DECLINED, isWaiting: true, needsHuman: true },
      'claude',
      interruptionOutput,
      100_000
    );

    expect(mockedSendToTmux).toHaveBeenCalledTimes(1);
    expect(String(mockedSendToTmux.mock.calls[0]?.[1] ?? '')).toContain('continue');

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-keep-attempts',
      agent,
      { state: AgentState.IDLE_AT_PROMPT, isWaiting: true, needsHuman: false },
      'claude',
      '› Summarize recent commits\n\n  gpt-5.2-codex xhigh · 46% left',
      161_000
    );

    expect(mockedSendToTmux).toHaveBeenCalledTimes(1);

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-keep-attempts',
      agent,
      { state: AgentState.USER_DECLINED, isWaiting: true, needsHuman: true },
      'claude',
      interruptionOutput,
      222_000
    );

    expect(mockedSendToTmux).toHaveBeenCalledTimes(2);
    expect(String(mockedSendToTmux.mock.calls[1]?.[1] ?? '')).toContain(
      'Manager auto-recovery: your session was interrupted.'
    );
  });

  it('resets interruption attempts after active progress resumes', async () => {
    const { sendToTmuxSession } = await import('./agent-monitoring.js');
    const mockedSendToTmux = vi.mocked(sendToTmuxSession);
    const { ctx } = makeCtx();
    const agent = {
      id: 'senior-reset-attempts',
      current_story_id: 'STORY-RESET-1',
    } as Parameters<typeof handleEscalationAndNudge>[2] & {};
    const interruptionOutput =
      '■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit `/feedback` to report the issue.';

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-reset-attempts',
      agent,
      { state: AgentState.USER_DECLINED, isWaiting: true, needsHuman: true },
      'claude',
      interruptionOutput,
      100_000
    );

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-reset-attempts',
      agent,
      { state: AgentState.TOOL_RUNNING, isWaiting: false, needsHuman: false },
      'claude',
      'Working (10s • esc to interrupt)',
      161_000
    );

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-reset-attempts',
      agent,
      { state: AgentState.USER_DECLINED, isWaiting: true, needsHuman: true },
      'claude',
      interruptionOutput,
      222_000
    );

    expect(mockedSendToTmux).toHaveBeenCalledTimes(2);
    expect(String(mockedSendToTmux.mock.calls[1]?.[1] ?? '')).toContain('continue');
  });
});

describe('handleEscalationAndNudge — fromAgentId FK fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCtx() {
    const dbInstance = {} as Database;
    return {
      ctx: {
        verbose: false,
        escalatedSessions: new Set<string>(),
        counters: { nudged: 0, escalationsCreated: 0, escalationsResolved: 0 },
        config: { manager: { nudge_cooldown_ms: 60000 } },
        withDb: async (fn: (db: { db: Database; save: () => void }) => Promise<unknown>) =>
          fn({ db: dbInstance, save: vi.fn() }),
      },
      dbInstance,
    };
  }

  it('uses agent.id (not session name) as fromAgentId when creating an escalation', async () => {
    const { createEscalation, getRecentEscalationsForAgent } =
      await import('../../../db/queries/escalations.js');
    vi.mocked(getRecentEscalationsForAgent).mockReturnValue([]);
    vi.mocked(createEscalation).mockReturnValue({
      id: 'ESC-TEST',
      story_id: 'STORY-001',
      from_agent_id: 'senior-AbCdEf',
      to_agent_id: null,
      reason: 'test',
      status: 'pending',
      resolution: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    });

    const { createLog } = await import('../../../db/queries/logs.js');
    vi.mocked(createLog).mockReturnValue(undefined as never);

    const { ctx } = makeCtx();
    const sessionName = 'hive-senior-AbCdEf'; // tmux session name with hive- prefix
    const agent = {
      id: 'senior-AbCdEf', // actual agent ID — no hive- prefix
      current_story_id: 'STORY-001',
    } as Parameters<typeof handleEscalationAndNudge>[2] & {};

    await handleEscalationAndNudge(
      ctx as never,
      sessionName,
      agent,
      { state: AgentState.ASKING_QUESTION, isWaiting: true, needsHuman: true },
      'claude',
      'Do you want to proceed?',
      Date.now()
    );

    expect(createEscalation).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(createEscalation).mock.calls[0]![1];
    expect(callArgs.fromAgentId).toBe('senior-AbCdEf');
    expect(callArgs.fromAgentId).not.toBe('hive-senior-AbCdEf');
  });

  it('uses null as fromAgentId when agent is undefined', async () => {
    const { createEscalation, getRecentEscalationsForAgent } =
      await import('../../../db/queries/escalations.js');
    vi.mocked(getRecentEscalationsForAgent).mockReturnValue([]);
    vi.mocked(createEscalation).mockReturnValue({
      id: 'ESC-NULL',
      story_id: null,
      from_agent_id: null,
      to_agent_id: null,
      reason: 'test',
      status: 'pending',
      resolution: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    });

    const { createLog } = await import('../../../db/queries/logs.js');
    vi.mocked(createLog).mockReturnValue(undefined as never);

    const { ctx } = makeCtx();

    await handleEscalationAndNudge(
      ctx as never,
      'hive-senior-XyZaBc',
      undefined, // no agent
      { state: AgentState.ASKING_QUESTION, isWaiting: true, needsHuman: true },
      'claude',
      'Do you want to proceed?',
      Date.now()
    );

    expect(createEscalation).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(createEscalation).mock.calls[0]![1];
    expect(callArgs.fromAgentId).toBeNull();
  });
});
