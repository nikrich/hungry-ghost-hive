// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { getAllAgents } from '../../../db/queries/agents.js';
import {
  createEscalation,
  getActiveEscalationsForAgent,
  getRecentEscalationsForAgent,
  updateEscalation,
} from '../../../db/queries/escalations.js';
import { createLog } from '../../../db/queries/logs.js';
import { killTmuxSession, sendEnterToTmuxSession } from '../../../tmux/manager.js';
import {
  AgentState,
  agentStates,
  buildAutoRecoveryReminder,
  describeAgentState,
  isRateLimitPrompt,
  sendToTmuxSession,
  withManagerNudgeEnvelope,
  type CLITool,
} from './agent-monitoring.js';
import type { ManagerCheckContext } from './types.js';
import { RECENT_ESCALATION_LOOKBACK_MINUTES } from './types.js';

const INTERRUPTION_FIRST_RECOVERY_COMMAND = 'continue';
const INTERRUPTION_HARD_RESET_ATTEMPTS = 3;
const RATE_LIMIT_INITIAL_BACKOFF_MS = 90000;
const RATE_LIMIT_MAX_BACKOFF_MS = 300000;
const interruptionRecoveryAttempts = new Map<string, number>();
const rateLimitRecoveryAttempts = new Map<string, number>();
const INTERRUPTION_PROMPT_PATTERN =
  /conversation interrupted|tell the model what to do differently|hit [`'"]?\/feedback[`'"]? to report the issue/i;

function isInterruptionPrompt(output: string): boolean {
  return INTERRUPTION_PROMPT_PATTERN.test(output);
}

function verboseLog(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

function getCodexPermissionActionHint(output: string): string | null {
  if (!/Yes,\s*and don't ask again/i.test(output)) {
    return null;
  }

  const prefixMatch = output.match(/commands that start with `([^`]+)`/i);
  if (prefixMatch?.[1]) {
    return `Select option 2 ("Yes, and don't ask again for commands that start with \`${prefixMatch[1]}\`").`;
  }

  return 'Select option 2 ("Yes, and don\'t ask again").';
}

function getGenericPermissionActionHint(output: string): string {
  if (/\[y\/n\]|\(y\/n\)|yes\/no/i.test(output)) {
    return 'Approve in the agent session (press y then Enter).';
  }
  return 'Approve the permission gate in the agent session.';
}

function getActionHintForBlockedState(
  state: import('../../../state-detectors/types.js').AgentState,
  cliTool: CLITool,
  output: string
): string {
  switch (state) {
    case AgentState.PERMISSION_REQUIRED: {
      if (cliTool === 'codex') {
        return getCodexPermissionActionHint(output) || getGenericPermissionActionHint(output);
      }
      return getGenericPermissionActionHint(output);
    }
    case AgentState.AWAITING_SELECTION:
      return 'Choose one of the presented options in the agent session and confirm.';
    case AgentState.ASKING_QUESTION:
      return 'Answer the question in the agent session, then press Enter.';
    case AgentState.PLAN_APPROVAL:
      return 'Approve the plan prompt in the agent session so work can continue.';
    case AgentState.USER_DECLINED:
      return 'Agent is blocked after a declined prompt; re-open the session and confirm the next gate.';
    default:
      return 'Open the agent session and resolve the blocked prompt.';
  }
}

export function buildHumanApprovalReason(
  sessionName: string,
  waitingReason: string | undefined,
  state: import('../../../state-detectors/types.js').AgentState,
  cliTool: CLITool,
  output: string
): string {
  const actionHint = getActionHintForBlockedState(state, cliTool, output);
  return `Approval required (${cliTool}) in ${sessionName}: ${waitingReason || 'Unknown question'}. Action: ${actionHint}`;
}

export function buildInterruptionRecoveryPrompt(
  sessionName: string,
  storyId?: string | null
): string {
  const storyLabel = storyId || 'your assigned story';
  const submitStory = storyId || '<story-id>';
  return `Manager auto-recovery: your session was interrupted. Continue ${storyLabel} from your last checkpoint now. Do not reply with a status update; resume implementation immediately, run tests/validation, then submit with: hive pr submit -b <branch> -s ${submitStory} --from ${sessionName}.`;
}

function getRateLimitBackoffMs(attempts: number): number {
  return Math.min(RATE_LIMIT_MAX_BACKOFF_MS, RATE_LIMIT_INITIAL_BACKOFF_MS * 2 ** attempts);
}

export function buildRateLimitRecoveryPrompt(
  sessionName: string,
  backoffMs: number,
  storyId?: string | null
): string {
  const storyLabel = storyId || 'your assigned story';
  const submitStory = storyId || '<story-id>';
  const backoffSeconds = Math.max(30, Math.round(backoffMs / 1000));
  return `Manager auto-recovery: rate limit detected (HTTP 429). Pause before retrying to reduce API pressure. Run: sleep ${backoffSeconds}. After the pause, continue ${storyLabel} from your last checkpoint and batch work to reduce requests. When done, submit with: hive pr submit -b <branch> -s ${submitStory} --from ${sessionName}.`;
}

export async function handleEscalationAndNudge(
  ctx: ManagerCheckContext,
  sessionName: string,
  agent: ReturnType<typeof getAllAgents>[number] | undefined,
  stateResult: {
    state: import('../../../state-detectors/types.js').AgentState;
    isWaiting: boolean;
    needsHuman: boolean;
  },
  agentCliTool: CLITool,
  output: string,
  now: number
): Promise<void> {
  const currentTrackedState = agentStates.get(sessionName);
  const lastEscalationNudgeTime = currentTrackedState
    ? (currentTrackedState.lastEscalationNudgeTime ?? currentTrackedState.lastNudgeTime)
    : 0;
  const interrupted =
    stateResult.state === AgentState.USER_DECLINED && isInterruptionPrompt(output);
  const rateLimited = isRateLimitPrompt(output);
  verboseLog(
    ctx,
    `escalationCheck: ${sessionName} state=${stateResult.state}, waiting=${stateResult.isWaiting}, needsHuman=${stateResult.needsHuman}, interrupted=${interrupted}, rateLimited=${rateLimited}`
  );

  if (!interrupted) {
    interruptionRecoveryAttempts.delete(sessionName);
  }
  if (!rateLimited) {
    rateLimitRecoveryAttempts.delete(sessionName);
  }

  if (rateLimited) {
    const attempts = rateLimitRecoveryAttempts.get(sessionName) || 0;
    const backoffMs = getRateLimitBackoffMs(attempts);
    const timeSinceLastNudge = currentTrackedState ? now - lastEscalationNudgeTime : Infinity;
    if (timeSinceLastNudge <= backoffMs) {
      verboseLog(
        ctx,
        `escalationCheck: ${sessionName} rate-limit backoff active (${Math.round(timeSinceLastNudge / 1000)}s elapsed < ${Math.round(backoffMs / 1000)}s required)`
      );
      return;
    }

    await sendToTmuxSession(
      sessionName,
      withManagerNudgeEnvelope(
        buildRateLimitRecoveryPrompt(sessionName, backoffMs, agent?.current_story_id)
      )
    );
    await sendEnterToTmuxSession(sessionName);
    rateLimitRecoveryAttempts.set(sessionName, attempts + 1);
    ctx.counters.nudged++;

    if (currentTrackedState) {
      currentTrackedState.lastEscalationNudgeTime = now;
    } else {
      agentStates.set(sessionName, {
        lastState: stateResult.state,
        lastStateChangeTime: now,
        lastNudgeTime: 0,
        storyStuckNudgeCount: 0,
        lastEscalationNudgeTime: now,
      });
    }

    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId: agent?.current_story_id || undefined,
      eventType: 'STORY_PROGRESS_UPDATE',
      message: `Auto-backoff message sent to rate-limited session ${sessionName}`,
      metadata: {
        session_name: sessionName,
        detected_state: stateResult.state,
        recovery: 'rate_limit_backoff',
        attempt: attempts + 1,
        backoff_ms: backoffMs,
      },
    });
    ctx.db.save();
    console.log(
      chalk.yellow(
        `  AUTO-BACKOFF: ${sessionName} hit rate limit, requested ${Math.round(backoffMs / 1000)}s pause`
      )
    );
    verboseLog(
      ctx,
      `escalationCheck: ${sessionName} action=rate_limit_backoff attempt=${attempts + 1}`
    );
    return;
  }

  // Conversation interruptions are usually recoverable without human intervention.
  // Try "continue" first, then stronger prompt, then recycle the session.
  if (interrupted) {
    const timeSinceLastNudge = currentTrackedState ? now - lastEscalationNudgeTime : Infinity;
    if (timeSinceLastNudge <= ctx.config.manager.nudge_cooldown_ms) {
      verboseLog(
        ctx,
        `escalationCheck: ${sessionName} interruption cooldown active (${Math.round(timeSinceLastNudge / 1000)}s)`
      );
      return;
    }

    const attempts = interruptionRecoveryAttempts.get(sessionName) || 0;
    if (attempts >= INTERRUPTION_HARD_RESET_ATTEMPTS) {
      await killTmuxSession(sessionName);
      interruptionRecoveryAttempts.delete(sessionName);
      createLog(ctx.db.db, {
        agentId: 'manager',
        storyId: agent?.current_story_id || undefined,
        eventType: 'STORY_PROGRESS_UPDATE',
        message: `Auto-restarted interrupted session ${sessionName} after ${attempts} failed recovery attempts`,
        metadata: {
          session_name: sessionName,
          detected_state: stateResult.state,
          recovery: 'conversation_interrupted_restart',
          attempts,
        },
      });
      ctx.db.save();
      console.log(
        chalk.yellow(
          `  AUTO-RESTART: ${sessionName} remained interrupted after ${attempts} attempts`
        )
      );
      verboseLog(ctx, `escalationCheck: ${sessionName} action=restart_after_interruption`);
      return;
    }

    const prompt =
      attempts === 0
        ? INTERRUPTION_FIRST_RECOVERY_COMMAND
        : buildInterruptionRecoveryPrompt(sessionName, agent?.current_story_id);
    await sendToTmuxSession(sessionName, withManagerNudgeEnvelope(prompt));
    await sendEnterToTmuxSession(sessionName);
    interruptionRecoveryAttempts.set(sessionName, attempts + 1);
    ctx.counters.nudged++;

    if (currentTrackedState) {
      currentTrackedState.lastEscalationNudgeTime = now;
    } else {
      agentStates.set(sessionName, {
        lastState: stateResult.state,
        lastStateChangeTime: now,
        lastNudgeTime: 0,
        storyStuckNudgeCount: 0,
        lastEscalationNudgeTime: now,
      });
    }

    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId: agent?.current_story_id || undefined,
      eventType: 'STORY_PROGRESS_UPDATE',
      message: `Auto-recovery message sent to interrupted session ${sessionName}`,
      metadata: {
        session_name: sessionName,
        detected_state: stateResult.state,
        recovery: 'conversation_interrupted',
        attempt: attempts + 1,
      },
    });
    ctx.db.save();
    verboseLog(
      ctx,
      `escalationCheck: ${sessionName} action=interruption_recovery_prompt attempt=${attempts + 1}`
    );

    return;
  }

  const waitingInfo = {
    isWaiting: stateResult.isWaiting,
    needsHuman: stateResult.needsHuman,
    reason: stateResult.needsHuman
      ? describeAgentState(stateResult.state, agentCliTool)
      : undefined,
  };

  const hasRecentEscalation =
    ctx.escalatedSessions.has(sessionName) ||
    getRecentEscalationsForAgent(ctx.db.db, sessionName, RECENT_ESCALATION_LOOKBACK_MINUTES)
      .length > 0;
  verboseLog(ctx, `escalationCheck: ${sessionName} hasRecentEscalation=${hasRecentEscalation}`);

  if (waitingInfo.needsHuman && !hasRecentEscalation) {
    // Create escalation for human attention
    const storyId = agent?.current_story_id || null;
    const escalationReason = buildHumanApprovalReason(
      sessionName,
      waitingInfo.reason,
      stateResult.state,
      agentCliTool,
      output
    );

    const escalation = createEscalation(ctx.db.db, {
      storyId,
      fromAgentId: sessionName,
      toAgentId: null,
      reason: escalationReason,
    });
    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId,
      eventType: 'ESCALATION_CREATED',
      status: 'error',
      message: `${sessionName} requires human approval: ${escalationReason}`,
      metadata: {
        escalation_id: escalation.id,
        session_name: sessionName,
        detected_state: stateResult.state,
      },
    });
    ctx.db.save();
    ctx.counters.escalationsCreated++;
    ctx.escalatedSessions.add(sessionName);

    const reminder = buildAutoRecoveryReminder(sessionName, agentCliTool);
    await sendToTmuxSession(sessionName, withManagerNudgeEnvelope(reminder));

    console.log(chalk.red(`  ESCALATION: ${sessionName} needs human input`));
    verboseLog(ctx, `escalationCheck: ${sessionName} action=create_escalation`);
  } else if (!waitingInfo.isWaiting && !waitingInfo.needsHuman) {
    interruptionRecoveryAttempts.delete(sessionName);
    // Agent recovered - auto-resolve active escalations
    const activeEscalations = getActiveEscalationsForAgent(ctx.db.db, sessionName);
    for (const escalation of activeEscalations) {
      updateEscalation(ctx.db.db, escalation.id, {
        status: 'resolved',
        resolution: `Agent recovered: no longer in waiting state`,
      });
      ctx.counters.escalationsResolved++;
    }
    if (activeEscalations.length > 0) {
      createLog(ctx.db.db, {
        agentId: 'manager',
        eventType: 'ESCALATION_RESOLVED',
        message: `${sessionName} recovered and manager auto-resolved ${activeEscalations.length} escalation(s)`,
        metadata: {
          session_name: sessionName,
          resolved_count: activeEscalations.length,
        },
      });
      ctx.db.save();
      console.log(
        chalk.green(
          `  AUTO-RESOLVED: ${sessionName} recovered, resolved ${activeEscalations.length} escalation(s)`
        )
      );
      verboseLog(
        ctx,
        `escalationCheck: ${sessionName} action=resolve_escalations count=${activeEscalations.length}`
      );
    }
  } else if (waitingInfo.isWaiting && stateResult.state !== AgentState.THINKING) {
    // Do not send generic idle nudges from escalation logic.
    // Stuck-story nudges and AI checks are handled in nudgeStuckStories.
    verboseLog(ctx, `escalationCheck: ${sessionName} skip=idle_waiting_no_escalation_nudge`);
  }
}
