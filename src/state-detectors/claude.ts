// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Claude Code State Detector
 *
 * Detects the UI state of Claude Code CLI based on output patterns
 * Refactored from src/utils/claude-code-state.ts
 */

import { BaseStateDetector, StateIndicator } from './base.js';
import { AgentState } from './types.js';

/**
 * Priority-based state indicators for Claude Code
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const CLAUDE_STATE_INDICATORS: StateIndicator[] = [
  // High priority: Active work states
  {
    state: AgentState.THINKING,
    patterns: [/\(thinking\)/i, /Concocting|Twisting|Considering|Analyzing/i],
    priority: 100,
  },
  {
    state: AgentState.TOOL_RUNNING,
    patterns: [
      /esc to interrupt/i,
      /Running|Executing/i,
      /\[.*\]\s+\d+%/i, // Progress bars
    ],
    priority: 100,
  },
  {
    state: AgentState.PROCESSING,
    patterns: [/Processing|Analyzing|Generating/i, /Please wait/i],
    priority: 90,
  },

  // High priority: Blocked states requiring human intervention
  {
    state: AgentState.AWAITING_SELECTION,
    patterns: [/Enter to select.*↑\/↓/i, /Use arrows to navigate/i, /Select an option/i],
    priority: 90,
  },
  {
    state: AgentState.ASKING_QUESTION,
    patterns: [
      /\?\s*$/m, // Line ending with question mark
      /Please (choose|select|confirm)/i,
      /Would you like to/i,
      /Do you want to/i,
    ],
    priority: 85,
  },
  {
    state: AgentState.PLAN_APPROVAL,
    patterns: [/approve.*plan/i, /review.*plan/i, /proceed.*plan/i, /ExitPlanMode/i],
    priority: 90,
  },
  {
    state: AgentState.PERMISSION_REQUIRED,
    patterns: [/permission.*required/i, /authorize/i, /Allow.*\[y\/n\]/i, /Approve.*\[y\/n\]/i],
    priority: 90,
  },
  {
    state: AgentState.USER_DECLINED,
    patterns: [/declined/i, /permission denied/i, /User chose not to/i],
    priority: 85,
  },

  // Lower priority: Ready/idle states
  {
    state: AgentState.WORK_COMPLETE,
    patterns: [/done|complete|finished/i, /successfully/i, /All.*tests passed/i],
    priority: 50,
  },
  {
    state: AgentState.IDLE_AT_PROMPT,
    patterns: [
      /^>\s*$/m, // Prompt alone on line
      /Ready for input/i,
      /What would you like/i,
    ],
    priority: 40,
  },
];

/**
 * Claude Code State Detector Implementation
 */
export class ClaudeStateDetector extends BaseStateDetector {
  constructor() {
    super('Claude', 0.9);
  }

  protected getIndicators(): StateIndicator[] {
    return CLAUDE_STATE_INDICATORS;
  }

  getStateDescription(state: AgentState): string {
    switch (state) {
      case AgentState.THINKING:
        return 'Claude is thinking';
      case AgentState.TOOL_RUNNING:
        return 'A tool is running';
      case AgentState.PROCESSING:
        return 'Processing request';
      case AgentState.IDLE_AT_PROMPT:
        return 'Idle at prompt';
      case AgentState.WORK_COMPLETE:
        return 'Work completed';
      case AgentState.ASKING_QUESTION:
        return 'Asking a question - needs response';
      case AgentState.AWAITING_SELECTION:
        return 'Awaiting user selection';
      case AgentState.PLAN_APPROVAL:
        return 'Waiting for plan approval';
      case AgentState.PERMISSION_REQUIRED:
        return 'Permission required';
      case AgentState.USER_DECLINED:
        return 'User declined - blocked';
      case AgentState.UNKNOWN:
        return 'Unknown state';
      default:
        return 'Unknown';
    }
  }
}
