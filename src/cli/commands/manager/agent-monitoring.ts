// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { HiveConfig } from '../../../config/schema.js';
import type { getAllAgents } from '../../../db/queries/agents.js';
import { createLog } from '../../../db/queries/logs.js';
import { getStateDetector, type StateDetectionResult } from '../../../state-detectors/index.js';
import { AgentState } from '../../../state-detectors/types.js';
import {
  autoApprovePermission,
  captureTmuxPane,
  forceBypassMode,
  sendEnterToTmuxSession,
  sendMessageWithConfirmation,
  sendToTmuxSession,
} from '../../../tmux/manager.js';
import {
  buildAutoRecoveryReminder,
  getAvailableCommands,
  type CLITool,
} from '../../../utils/cli-commands.js';
import type { AgentStateTracking, ManagerCheckContext, MessageRow } from './types.js';
import { BYPASS_MODE_MAX_RETRIES, MESSAGE_FORWARD_DELAY_MS, POST_NUDGE_DELAY_MS } from './types.js';

// In-memory state tracking per agent session
export const agentStates = new Map<string, AgentStateTracking>();

export const stateDetectors: Record<CLITool, ReturnType<typeof getStateDetector>> = {
  claude: getStateDetector('claude'),
  codex: getStateDetector('codex'),
  gemini: getStateDetector('gemini'),
};

export function detectAgentState(output: string, cliTool: CLITool): StateDetectionResult {
  return stateDetectors[cliTool].detectState(output);
}

export function describeAgentState(state: AgentState, cliTool: CLITool): string {
  return stateDetectors[cliTool].getStateDescription(state);
}

export function getAgentSafetyMode(
  config: HiveConfig,
  agent: ReturnType<typeof getAllAgents>[number] | undefined
): 'safe' | 'unsafe' {
  if (!agent) return 'unsafe';
  return config.models[agent.type].safety_mode;
}

export async function enforceBypassMode(
  sessionName: string,
  output: string,
  agentCliTool: CLITool,
  safetyMode: 'safe' | 'unsafe'
): Promise<void> {
  if (safetyMode === 'safe') {
    return;
  }

  const needsBypassEnforcement =
    output.toLowerCase().includes('plan mode on') ||
    output.toLowerCase().includes('safe mode on') ||
    output.match(/permission.*required/i) ||
    output.match(/approve.*\[y\/n\]/i);

  if (needsBypassEnforcement) {
    const enforced = await forceBypassMode(sessionName, agentCliTool, BYPASS_MODE_MAX_RETRIES);
    if (enforced) {
      console.log(chalk.yellow(`  Enforced bypass mode on ${sessionName}`));
    } else {
      console.log(chalk.red(`  Failed to enforce bypass mode on ${sessionName}`));
    }
  }
}

export function updateAgentStateTracking(
  sessionName: string,
  stateResult: StateDetectionResult,
  now: number
): void {
  const trackedState = agentStates.get(sessionName);

  if (!trackedState) {
    agentStates.set(sessionName, {
      lastState: stateResult.state,
      lastStateChangeTime: now,
      lastNudgeTime: 0,
    });
  } else if (trackedState.lastState !== stateResult.state) {
    trackedState.lastState = stateResult.state;
    trackedState.lastStateChangeTime = now;
  }
}

export async function handlePermissionPrompt(
  ctx: ManagerCheckContext,
  sessionName: string,
  stateResult: StateDetectionResult,
  safetyMode: 'safe' | 'unsafe'
): Promise<boolean> {
  if (stateResult.state === AgentState.PERMISSION_REQUIRED && safetyMode === 'unsafe') {
    const approved = await autoApprovePermission(sessionName);
    if (approved) {
      createLog(ctx.db.db, {
        agentId: 'manager',
        eventType: 'STORY_PROGRESS_UPDATE',
        message: `Auto-approved permission prompt for ${sessionName}`,
        metadata: {
          session_name: sessionName,
          detected_state: stateResult.state,
        },
      });
      ctx.db.save();
      console.log(chalk.green(`  AUTO-APPROVED: ${sessionName} permission prompt`));
      return true;
    }
  }
  return false;
}

export async function handlePlanApproval(
  sessionName: string,
  stateResult: StateDetectionResult,
  now: number,
  agentCliTool: CLITool,
  safetyMode: 'safe' | 'unsafe'
): Promise<void> {
  if (stateResult.state === AgentState.PLAN_APPROVAL && safetyMode === 'unsafe') {
    const restored = await forceBypassMode(sessionName, agentCliTool);
    if (restored) {
      console.log(chalk.green(`  BYPASS MODE RESTORED: ${sessionName} cycled out of plan mode`));
      const tracked = agentStates.get(sessionName);
      if (tracked) {
        tracked.lastState = AgentState.IDLE_AT_PROMPT;
        tracked.lastStateChangeTime = now;
      }
    }
  }
}

export function getAgentType(
  sessionName: string
): 'senior' | 'intermediate' | 'junior' | 'qa' | 'unknown' {
  if (sessionName.includes('-senior-')) return 'senior';
  if (sessionName.includes('-intermediate-')) return 'intermediate';
  if (sessionName.includes('-junior-')) return 'junior';
  if (sessionName.includes('-qa-')) return 'qa';
  return 'unknown';
}

export async function nudgeAgent(
  _root: string,
  sessionName: string,
  customMessage?: string,
  agentType?: string,
  reason?: string,
  agentCliTool?: CLITool
): Promise<void> {
  if (customMessage) {
    await sendToTmuxSession(sessionName, customMessage);
    return;
  }

  const type = agentType || getAgentType(sessionName);
  const cliTool = agentCliTool || ('claude' as CLITool);
  const commands = getAvailableCommands(cliTool);

  // Build contextual nudge message based on agent type and reason
  let nudge: string;
  switch (type) {
    case 'qa':
      nudge = `# You are a QA agent. Check for PRs to review:
# ${commands.queueCheck()}
# If there are PRs, review them with: hive pr review <pr-id>`;
      break;
    case 'senior':
      nudge = `# You are a Senior developer. Continue with your assigned stories.
# Check your work: # ${commands.getMyStories(sessionName)}
# If no active stories, check for available work: hive stories list --status planned`;
      break;
    case 'intermediate':
    case 'junior':
      nudge = `# Continue with your assigned story. Check status:
# ${commands.getMyStories(sessionName)}
# If stuck, ask your Senior for help via: hive msg send hive-senior-<team> "your question"
# If done, submit PR: hive pr submit -b <branch> -s <story-id> --from ${sessionName}`;
      break;
    default:
      nudge = `# Check current status and continue working:
hive status`;
  }

  // Add reason context if provided
  if (reason) {
    nudge = `# Manager detected: ${reason}\n${nudge}`;
  }

  await sendToTmuxSession(sessionName, nudge);

  // Also send Enter to ensure prompt is activated
  await new Promise(resolve => setTimeout(resolve, POST_NUDGE_DELAY_MS));
  await sendEnterToTmuxSession(sessionName);
}

export async function forwardMessages(
  sessionName: string,
  messages: MessageRow[],
  cliTool: CLITool = 'claude'
): Promise<void> {
  const commands = getAvailableCommands(cliTool);
  for (const msg of messages) {
    const notification = `# New message from ${msg.from_session}${msg.subject ? ` - ${msg.subject}` : ''}
# ${msg.body}
# Reply with: # ${commands.msgReply(msg.id, 'your response', sessionName)}`;

    // Send with delivery confirmation - wait for message to appear in session output before proceeding
    const delivered = await sendMessageWithConfirmation(sessionName, notification);

    if (!delivered) {
      console.warn(
        `Failed to confirm delivery of message ${msg.id} to ${sessionName} after retries`
      );
      // Continue to next message even if delivery not confirmed to avoid blocking the manager
    }

    // Small delay between messages to allow recipient time to read
    await new Promise(resolve => setTimeout(resolve, MESSAGE_FORWARD_DELAY_MS));
  }
}

export { AgentState, buildAutoRecoveryReminder, captureTmuxPane, sendToTmuxSession };
export type { CLITool, StateDetectionResult };
