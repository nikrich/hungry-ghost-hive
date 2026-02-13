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
  agentStates,
  buildAutoRecoveryReminder,
  captureTmuxPane,
  describeAgentState,
  detectAgentState,
  getAgentType,
  nudgeAgent,
  sendToTmuxSession,
  AgentState,
  type CLITool,
} from './agent-monitoring.js';
import type { ManagerCheckContext } from './types.js';
import { RECENT_ESCALATION_LOOKBACK_MINUTES, TMUX_CAPTURE_LINES } from './types.js';

export async function handleEscalationAndNudge(
  ctx: ManagerCheckContext,
  sessionName: string,
  agent: ReturnType<typeof getAllAgents>[number] | undefined,
  stateResult: { state: import('../../../state-detectors/types.js').AgentState; isWaiting: boolean; needsHuman: boolean },
  agentCliTool: CLITool,
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

    const escalation = createEscalation(ctx.db.db, {
      storyId,
      fromAgentId: sessionName,
      toAgentId: null,
      reason: `Approval required: ${waitingInfo.reason || 'Unknown question'}`,
    });
    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId,
      eventType: 'ESCALATION_CREATED',
      status: 'error',
      message: `${sessionName} requires human approval: ${waitingInfo.reason || 'Unknown question'}`,
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
