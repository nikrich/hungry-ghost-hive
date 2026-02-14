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
import { killTmuxSession } from '../../../tmux/manager.js';
import {
  AgentState,
  agentStates,
  buildAutoRecoveryReminder,
  captureTmuxPane,
  describeAgentState,
  detectAgentState,
  getAgentType,
  isInterruptionPrompt,
  nudgeAgent,
  sendEnterToTmuxSession,
  sendToTmuxSession,
  type CLITool,
} from './agent-monitoring.js';
import type { ManagerCheckContext } from './types.js';
import { RECENT_ESCALATION_LOOKBACK_MINUTES, TMUX_CAPTURE_LINES } from './types.js';

const INTERRUPTION_FIRST_RECOVERY_COMMAND = 'continue';
const INTERRUPTION_HARD_RESET_ATTEMPTS = 3;
const interruptionRecoveryAttempts = new Map<string, number>();

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
  const interrupted = stateResult.state === AgentState.USER_DECLINED && isInterruptionPrompt(output);

  if (!interrupted) {
    interruptionRecoveryAttempts.delete(sessionName);
  }

  // Conversation interruptions are usually recoverable without human intervention.
  // Try "continue" first, then stronger prompt, then recycle the session.
  if (interrupted) {
    const timeSinceLastNudge = currentTrackedState
      ? now - currentTrackedState.lastNudgeTime
      : Infinity;
    if (timeSinceLastNudge <= ctx.config.manager.nudge_cooldown_ms) {
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
        chalk.yellow(`  AUTO-RESTART: ${sessionName} remained interrupted after ${attempts} attempts`)
      );
      return;
    }

    const prompt =
      attempts === 0
        ? INTERRUPTION_FIRST_RECOVERY_COMMAND
        : buildInterruptionRecoveryPrompt(sessionName, agent?.current_story_id);
    await sendToTmuxSession(sessionName, prompt);
    await sendEnterToTmuxSession(sessionName);
    interruptionRecoveryAttempts.set(sessionName, attempts + 1);
    ctx.counters.nudged++;

    if (currentTrackedState) {
      currentTrackedState.lastNudgeTime = now;
    } else {
      agentStates.set(sessionName, {
        lastState: stateResult.state,
        lastStateChangeTime: now,
        lastNudgeTime: now,
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
    await sendToTmuxSession(sessionName, reminder);

    console.log(chalk.red(`  ESCALATION: ${sessionName} needs human input`));
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
    }
  } else if (waitingInfo.isWaiting && stateResult.state !== AgentState.THINKING) {
    // Agent idle/waiting - check if we should nudge
    if (currentTrackedState) {
      const timeSinceStateChange = now - currentTrackedState.lastStateChangeTime;
      const timeSinceLastNudge = now - currentTrackedState.lastNudgeTime;

      if (
        timeSinceStateChange > ctx.config.manager.stuck_threshold_ms &&
        timeSinceLastNudge > ctx.config.manager.nudge_cooldown_ms
      ) {
        const recheckOutput = await captureTmuxPane(sessionName, TMUX_CAPTURE_LINES);
        const recheckState = detectAgentState(recheckOutput, agentCliTool);

        if (
          recheckState.isWaiting &&
          !recheckState.needsHuman &&
          recheckState.state !== AgentState.THINKING
        ) {
          const agentType = getAgentType(sessionName);
          await nudgeAgent(
            ctx.root,
            sessionName,
            undefined,
            agentType,
            waitingInfo.reason,
            agentCliTool
          );
          currentTrackedState.lastNudgeTime = now;
          ctx.counters.nudged++;
        }
      }
    }
  }
}
