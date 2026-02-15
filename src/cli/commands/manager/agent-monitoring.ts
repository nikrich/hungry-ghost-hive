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
import {
  BYPASS_MODE_MAX_RETRIES,
  MANAGER_NUDGE_END_MARKER,
  MANAGER_NUDGE_START_MARKER,
  MESSAGE_FORWARD_DELAY_MS,
  POST_NUDGE_DELAY_MS,
} from './types.js';

// In-memory state tracking per agent session
export const agentStates = new Map<string, AgentStateTracking>();

export const stateDetectors: Record<CLITool, ReturnType<typeof getStateDetector>> = {
  claude: getStateDetector('claude'),
  codex: getStateDetector('codex'),
  gemini: getStateDetector('gemini'),
};

const INTERRUPTION_PROMPT_PATTERN =
  /conversation interrupted|tell the model what to do differently|hit [`'"]?\/feedback[`'"]? to report the issue/i;
const RATE_LIMIT_HARD_PATTERNS = [
  /too many requests/i,
  /rate_limit_error/i,
  /resource[_\s-]?exhausted/i,
  /request(?:\s+has\s+been)?\s+throttled/i,
  /rate[\s_-]?limit(?:\s+reached|\s+exceeded)/i,
  /(?:status|error|code)\s*[:=]?\s*429\b/i,
  /\b429\b.*(?:too many requests|rate[\s_-]?limit|throttl|quota|retry)/i,
];
const RATE_LIMIT_CONTEXT_PATTERNS = [
  /\b429\b/i,
  /rate[\s_-]?limit/i,
  /quota/i,
  /resource[_\s-]?exhausted/i,
  /throttl/i,
  /requests?\s+per\s+(?:min|minute)/i,
  /tokens?\s+per\s+(?:min|minute)/i,
  /\b(?:rpm|tpm)\b/i,
];
const RATE_LIMIT_RETRY_PATTERNS = [
  /retry after/i,
  /exceeded retry limit/i,
  /try again/i,
  /backoff/i,
];
const INTERACTIVE_PROMPT_LINE_PATTERN = /^\s*(?:›|>)\s+\S.+$/m;
const INTERACTIVE_PROMPT_UI_SIGNAL_PATTERNS = [
  /\?\s*for shortcuts/i,
  /\bcontext left\b/i,
  /\[pasted content\s+\d+\s+chars\]/i,
];
const INTERACTIVE_PROMPT_HUMAN_NEEDED_PATTERNS = [
  /\?\s*$/,
  /\b(?:choose|select|pick)\b/i,
  /\b(?:confirm|approve|deny)\b/i,
  /\b(?:yes|no|y\/n)\b/i,
];
const RATE_LIMIT_WINDOW_LINES = 120;
const INTERACTIVE_PROMPT_WINDOW_LINES = 80;

function getRecentPaneOutput(output: string, lineCount: number): string {
  return output.split('\n').slice(-lineCount).join('\n');
}

export function isInterruptionPrompt(output: string): boolean {
  return INTERRUPTION_PROMPT_PATTERN.test(output);
}

export function isRateLimitPrompt(output: string): boolean {
  const recentOutput = getRecentPaneOutput(output, RATE_LIMIT_WINDOW_LINES);
  if (RATE_LIMIT_HARD_PATTERNS.some(pattern => pattern.test(recentOutput))) {
    return true;
  }

  const hasRateLimitContext = RATE_LIMIT_CONTEXT_PATTERNS.some(pattern =>
    pattern.test(recentOutput)
  );
  const hasRetrySignal = RATE_LIMIT_RETRY_PATTERNS.some(pattern => pattern.test(recentOutput));
  return hasRateLimitContext && hasRetrySignal;
}

export function isInteractiveInputPrompt(output: string): boolean {
  const recentOutput = getRecentPaneOutput(output, INTERACTIVE_PROMPT_WINDOW_LINES);
  const hasUiSignal = INTERACTIVE_PROMPT_UI_SIGNAL_PATTERNS.some(pattern =>
    pattern.test(recentOutput)
  );
  return INTERACTIVE_PROMPT_LINE_PATTERN.test(recentOutput) && hasUiSignal;
}

function getLatestInteractivePromptLine(output: string): string | null {
  const recentOutput = getRecentPaneOutput(output, INTERACTIVE_PROMPT_WINDOW_LINES);
  const lines = recentOutput.split('\n').reverse();
  for (const line of lines) {
    if (INTERACTIVE_PROMPT_LINE_PATTERN.test(line)) {
      return line.trim();
    }
  }
  return null;
}

function interactivePromptNeedsHuman(output: string): boolean {
  const promptLine = getLatestInteractivePromptLine(output);
  if (!promptLine) return false;
  const normalizedPrompt = promptLine.replace(/^\s*(?:›|>)\s*/, '');
  return INTERACTIVE_PROMPT_HUMAN_NEEDED_PATTERNS.some(pattern => pattern.test(normalizedPrompt));
}

export function detectAgentState(output: string, cliTool: CLITool): StateDetectionResult {
  // Interruption banners can coexist with stale "working" text in pane history.
  // Treat interruption as authoritative blocked state to force escalation.
  if (isInterruptionPrompt(output)) {
    return {
      state: AgentState.USER_DECLINED,
      confidence: 0.9,
      reason: `Detected ${cliTool} interruption prompt`,
      isWaiting: true,
      needsHuman: true,
    };
  }

  // API throttling is recoverable by backing off and retrying.
  // Keep this ahead of normal detector logic so stale prompts do not trigger escalations.
  if (isRateLimitPrompt(output)) {
    return {
      state: AgentState.USER_DECLINED,
      confidence: 0.85,
      reason: `Detected ${cliTool} rate-limit prompt`,
      isWaiting: true,
      needsHuman: false,
    };
  }

  // Cross-CLI interactive prompts (e.g. "› ...", "? for shortcuts") mean the
  // agent is waiting at prompt, even if stale pane text contains active words.
  // Some prompt lines are actual questions/approvals (needsHuman=true), while
  // others are just ready-for-input idle prompts (needsHuman=false).
  if (isInteractiveInputPrompt(output)) {
    const needsHuman = interactivePromptNeedsHuman(output);
    return {
      state: needsHuman ? AgentState.ASKING_QUESTION : AgentState.IDLE_AT_PROMPT,
      confidence: 0.9,
      reason: `Detected ${cliTool} interactive input prompt (${needsHuman ? 'question' : 'idle'})`,
      isWaiting: true,
      needsHuman,
    };
  }

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
      storyStuckNudgeCount: 0,
      lastEscalationNudgeTime: 0,
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

export function withManagerNudgeEnvelope(message: string): string {
  return `# ${MANAGER_NUDGE_START_MARKER}
${message}
# ${MANAGER_NUDGE_END_MARKER}`;
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
    await sendToTmuxSession(sessionName, withManagerNudgeEnvelope(customMessage));
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

  await sendToTmuxSession(sessionName, withManagerNudgeEnvelope(nudge));

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

export {
  AgentState,
  buildAutoRecoveryReminder,
  captureTmuxPane,
  sendEnterToTmuxSession,
  sendToTmuxSession,
};
export type { CLITool, StateDetectionResult };
