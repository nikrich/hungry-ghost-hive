/**
 * Claude Code State Detector
 *
 * Detects the UI state of Claude Code CLI based on output patterns
 * Refactored from src/utils/claude-code-state.ts
 */

import { AgentState, StateDetectionResult, StateDetector } from './types';

interface StateIndicator {
  state: AgentState;
  patterns: RegExp[];
  priority: number;
}

/**
 * Priority-based state indicators for Claude Code
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const CLAUDE_STATE_INDICATORS: StateIndicator[] = [
  // High priority: Active work states
  {
    state: AgentState.THINKING,
    patterns: [
      /\(thinking\)/i,
      /Concocting|Twisting|Considering|Analyzing/i,
    ],
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
    patterns: [
      /Processing|Analyzing|Generating/i,
      /Please wait/i,
    ],
    priority: 90,
  },

  // High priority: Blocked states requiring human intervention
  {
    state: AgentState.AWAITING_SELECTION,
    patterns: [
      /Enter to select.*↑\/↓/i,
      /Use arrows to navigate/i,
      /Select an option/i,
    ],
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
    patterns: [
      /approve.*plan/i,
      /review.*plan/i,
      /proceed.*plan/i,
      /ExitPlanMode/i,
    ],
    priority: 90,
  },
  {
    state: AgentState.PERMISSION_REQUIRED,
    patterns: [
      /permission.*required/i,
      /authorize/i,
      /Allow.*\[y\/n\]/i,
      /Approve.*\[y\/n\]/i,
    ],
    priority: 90,
  },
  {
    state: AgentState.USER_DECLINED,
    patterns: [
      /declined/i,
      /permission denied/i,
      /User chose not to/i,
    ],
    priority: 85,
  },

  // Lower priority: Ready/idle states
  {
    state: AgentState.WORK_COMPLETE,
    patterns: [
      /done|complete|finished/i,
      /successfully/i,
      /All.*tests passed/i,
    ],
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
export class ClaudeStateDetector implements StateDetector {
  /**
   * Detect the current Claude Code UI state from output text
   */
  detectState(output: string): StateDetectionResult {
    // Sort indicators by priority (highest first)
    const sortedIndicators = [...CLAUDE_STATE_INDICATORS].sort((a, b) => b.priority - a.priority);

    // Check each indicator in priority order
    for (const indicator of sortedIndicators) {
      for (const pattern of indicator.patterns) {
        if (pattern.test(output)) {
          const result = this.mapStateToWaitingStatus(indicator.state);
          return {
            ...result,
            confidence: 0.9,
            reason: `Detected pattern for ${indicator.state}`,
          };
        }
      }
    }

    // No clear state detected
    return {
      state: AgentState.UNKNOWN,
      confidence: 0.3,
      reason: 'No clear state indicators found',
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
