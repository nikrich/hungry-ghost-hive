// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Gemini CLI State Detector
 *
 * Detects the UI state of Gemini CLI based on output patterns
 * Note: These patterns are based on common CLI patterns and may need adjustment
 * based on actual Gemini CLI output behavior
 */

import { BaseStateDetector, StateIndicator } from './base.js';
import { AgentState } from './types.js';

/**
 * Priority-based state indicators for Gemini CLI
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const GEMINI_STATE_INDICATORS: StateIndicator[] = [
  // High priority: Active work states
  {
    state: AgentState.THINKING,
    patterns: [/thinking\.\.\./i, /processing your request/i, /analyzing/i, /generating/i],
    priority: 100,
  },
  {
    state: AgentState.TOOL_RUNNING,
    patterns: [
      /executing tool/i,
      /running/i,
      /\[━+\s*\]/i, // Progress bars with unicode characters
      /\d+\/\d+/i, // Progress like "3/10"
    ],
    priority: 100,
  },
  {
    state: AgentState.PROCESSING,
    patterns: [/\bprocessing\b/i, /\bcomputing\b/i, /working on it/i],
    priority: 90,
  },

  // High priority: Blocked states requiring human intervention
  {
    state: AgentState.AWAITING_SELECTION,
    patterns: [
      /select.*option/i,
      /choose one/i,
      /pick an option/i,
      /\[\d+\]/i, // Bracketed numbers
    ],
    priority: 90,
  },
  {
    state: AgentState.ASKING_QUESTION,
    patterns: [
      /\?\s*$/m, // Line ending with question mark
      /please (confirm|verify)/i,
      /shall I/i,
      /do you want/i,
    ],
    priority: 85,
  },
  {
    state: AgentState.PERMISSION_REQUIRED,
    patterns: [/permission required/i, /authorization/i, /confirm action/i, /\(y\/n\)/i],
    priority: 90,
  },
  {
    state: AgentState.USER_DECLINED,
    patterns: [/declined/i, /rejected/i, /cancelled by user/i, /aborted/i],
    priority: 85,
  },

  // Lower priority: Ready/idle states
  {
    state: AgentState.WORK_COMPLETE,
    patterns: [/task complete/i, /done/i, /finished successfully/i, /completed/i],
    priority: 50,
  },
  {
    state: AgentState.IDLE_AT_PROMPT,
    patterns: [
      /^>\s*$/m, // Prompt alone on line
      /^gemini>\s*$/m,
      /ready for input/i,
      /how can I help you/i,
    ],
    priority: 95, // High priority to catch this before ASKING_QUESTION
  },
];

/**
 * Gemini CLI State Detector Implementation
 */
export class GeminiStateDetector extends BaseStateDetector {
  constructor() {
    super('Gemini', 0.85);
  }

  protected getIndicators(): StateIndicator[] {
    return GEMINI_STATE_INDICATORS;
  }

  getStateDescription(state: AgentState): string {
    switch (state) {
      case AgentState.THINKING:
        return 'Gemini is thinking';
      case AgentState.TOOL_RUNNING:
        return 'Running tool';
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
