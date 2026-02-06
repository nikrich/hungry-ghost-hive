/**
 * Codex CLI State Detector
 *
 * Detects the UI state of Codex CLI based on output patterns
 * Note: These patterns are based on common CLI patterns and may need adjustment
 * based on actual Codex CLI output behavior
 */

import { AgentState, StateDetectionResult, StateDetector } from './types.js';

interface StateIndicator {
  state: AgentState;
  patterns: RegExp[];
  priority: number;
}

/**
 * Priority-based state indicators for Codex CLI
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const CODEX_STATE_INDICATORS: StateIndicator[] = [
  // High priority: Active work states
  {
    state: AgentState.THINKING,
    patterns: [
      /thinking\.\.\./i,
      /analyzing|considering/i,
      /generating response/i,
    ],
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
    patterns: [
      /processing/i,
      /loading/i,
      /working/i,
    ],
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
    ],
    priority: 90,
  },
  {
    state: AgentState.USER_DECLINED,
    patterns: [
      /declined/i,
      /denied/i,
      /cancelled/i,
      /aborted/i,
    ],
    priority: 85,
  },

  // Lower priority: Ready/idle states
  {
    state: AgentState.WORK_COMPLETE,
    patterns: [
      /done/i,
      /completed/i,
      /finished/i,
      /success/i,
    ],
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
export class CodexStateDetector implements StateDetector {
  /**
   * Detect the current Codex CLI state from output text
   */
  detectState(output: string): StateDetectionResult {
    // Sort indicators by priority (highest first)
    const sortedIndicators = [...CODEX_STATE_INDICATORS].sort((a, b) => b.priority - a.priority);

    // Check each indicator in priority order
    for (const indicator of sortedIndicators) {
      for (const pattern of indicator.patterns) {
        if (pattern.test(output)) {
          const result = this.mapStateToWaitingStatus(indicator.state);
          return {
            ...result,
            confidence: 0.85, // Slightly lower confidence for Codex patterns
            reason: `Detected Codex pattern for ${indicator.state}`,
          };
        }
      }
    }

    // No clear state detected
    return {
      state: AgentState.UNKNOWN,
      confidence: 0.3,
      reason: 'No clear Codex state indicators found',
      isWaiting: false,
      needsHuman: false,
    };
  }

  /**
   * Get a human-readable description of a state
   */
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

  /**
   * Check if a state represents active work (not waiting)
   */
  isActiveState(state: AgentState): boolean {
    return [
      AgentState.THINKING,
      AgentState.TOOL_RUNNING,
      AgentState.PROCESSING,
    ].includes(state);
  }

  /**
   * Check if a state requires human intervention
   */
  isBlockedState(state: AgentState): boolean {
    return [
      AgentState.ASKING_QUESTION,
      AgentState.AWAITING_SELECTION,
      AgentState.PLAN_APPROVAL,
      AgentState.PERMISSION_REQUIRED,
      AgentState.USER_DECLINED,
    ].includes(state);
  }

  /**
   * Map a state to waiting status flags
   */
  private mapStateToWaitingStatus(state: AgentState): Omit<StateDetectionResult, 'confidence' | 'reason'> {
    switch (state) {
      // Active states - not waiting
      case AgentState.THINKING:
      case AgentState.TOOL_RUNNING:
      case AgentState.PROCESSING:
        return {
          state,
          isWaiting: false,
          needsHuman: false,
        };

      // Idle states - waiting but not blocked
      case AgentState.IDLE_AT_PROMPT:
      case AgentState.WORK_COMPLETE:
        return {
          state,
          isWaiting: true,
          needsHuman: false,
        };

      // Blocked states - waiting and needs human
      case AgentState.ASKING_QUESTION:
      case AgentState.AWAITING_SELECTION:
      case AgentState.PLAN_APPROVAL:
      case AgentState.PERMISSION_REQUIRED:
      case AgentState.USER_DECLINED:
        return {
          state,
          isWaiting: true,
          needsHuman: true,
        };

      // Unknown state - assume not waiting
      case AgentState.UNKNOWN:
      default:
        return {
          state,
          isWaiting: false,
          needsHuman: false,
        };
    }
  }
}
