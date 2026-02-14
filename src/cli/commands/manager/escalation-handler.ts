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
import {
  AgentState,
  agentStates,
  buildAutoRecoveryReminder,
  captureTmuxPane,
  describeAgentState,
  detectAgentState,
  getAgentType,
  nudgeAgent,
  sendToTmuxSession,
  type CLITool,
} from './agent-monitoring.js';
import type { ManagerCheckContext } from './types.js';
import { RECENT_ESCALATION_LOOKBACK_MINUTES, TMUX_CAPTURE_LINES } from './types.js';

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

function buildHumanApprovalReason(
  sessionName: string,
  waitingReason: string | undefined,
  state: import('../../../state-detectors/types.js').AgentState,
  cliTool: CLITool,
  output: string
): string {
  if (cliTool === 'codex' && state === AgentState.PERMISSION_REQUIRED) {
    const actionHint = getCodexPermissionActionHint(output);
    if (actionHint) {
      return `Approval required: Codex permission gate in ${sessionName}. ${actionHint} This persists the approval and restores autonomous execution.`;
    }
  }

  return `Approval required: ${waitingReason || 'Unknown question'}`;
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
    const currentTrackedState = agentStates.get(sessionName);
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
