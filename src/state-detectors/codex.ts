// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Codex CLI State Detector
 *
 * Detects the UI state of Codex CLI based on output patterns
 * Note: These patterns are based on common CLI patterns and may need adjustment
 * based on actual Codex CLI output behavior
 */

import { BaseStateDetector, StateIndicator } from './base.js';
import { AgentState } from './types.js';

/**
 * Priority-based state indicators for Codex CLI
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const CODEX_STATE_INDICATORS: StateIndicator[] = [
  // High priority: Active work states
  {
    state: AgentState.THINKING,
    patterns: [/thinking\.\.\./i, /analyzing|considering/i, /generating response/i],
    priority: 100,
  },
  {
    state: AgentState.TOOL_RUNNING,
    patterns: [
      /executing/i,
      /running command/i,
      /\[\s*=+\s*\]/i, // Progress bars with = signs
      /\d+%\s*complete/i,
    ],
    priority: 100,
  },
  {
    state: AgentState.PROCESSING,
    patterns: [/processing/i, /loading/i, /working/i],
    priority: 90,
  },

  // High priority: Blocked states requiring human intervention
  {
    state: AgentState.AWAITING_SELECTION,
    patterns: [
      /select an option/i,
      /choose from the following/i,
      /\[1-9\]/i, // Numbered options
    ],
    priority: 90,
  },
  {
    state: AgentState.ASKING_QUESTION,
    patterns: [
      /\?\s*$/m, // Line ending with question mark
      /please confirm/i,
      /do you want/i,
      /would you like/i,
    ],
    priority: 85,
  },
  {
    state: AgentState.PERMISSION_REQUIRED,
    patterns: [
      /permission required/i,
      /authorization needed/i,
      /\[y\/n\]/i,
      /approve/i,
      /Would you like to run the following command\?/i,
      /Yes,\s*proceed\s*\(y\)/i,
      /Press enter to confirm/i,
    ],
    priority: 90,
  },
  {
    state: AgentState.USER_DECLINED,
    patterns: [/declined/i, /denied/i, /cancelled/i, /aborted/i],
    priority: 85,
  },

  // Lower priority: Ready/idle states
  {
    state: AgentState.WORK_COMPLETE,
    patterns: [/done/i, /completed/i, /finished/i, /success/i],
    priority: 50,
  },
  {
    state: AgentState.IDLE_AT_PROMPT,
    patterns: [
      /^>\s*$/m, // Prompt alone on line
      /^codex>\s*$/m,
      /waiting for input/i,
    ],
    priority: 40,
  },
];

/**
 * Codex CLI State Detector Implementation
 */
export class CodexStateDetector extends BaseStateDetector {
  constructor() {
    super('Codex', 0.85);
  }

  protected getIndicators(): StateIndicator[] {
    return CODEX_STATE_INDICATORS;
  }

  getStateDescription(state: AgentState): string {
    switch (state) {
      case AgentState.THINKING:
        return 'Codex is thinking';
      case AgentState.TOOL_RUNNING:
        return 'Running command';
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
        return 'Waiting for approval';
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
