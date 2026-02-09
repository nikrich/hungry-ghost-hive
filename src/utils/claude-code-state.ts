// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Claude Code UI State Detection
 *
 * Provides robust state machine-based detection of Claude Code's UI state
 * to determine when agents are blocked and need human intervention.
 */

export enum ClaudeCodeState {
  // Active states - Claude is actively working
  THINKING = 'thinking',
  TOOL_RUNNING = 'tool_running',
  PROCESSING = 'processing',

  // Waiting states - idle at prompt, ready for input
  IDLE_AT_PROMPT = 'idle_at_prompt',
  WORK_COMPLETE = 'work_complete',

  // Blocked states - requires human intervention
  ASKING_QUESTION = 'asking_question',
  AWAITING_SELECTION = 'awaiting_selection',
  PLAN_APPROVAL = 'plan_approval',
  PERMISSION_REQUIRED = 'permission_required',
  USER_DECLINED = 'user_declined',

  // Unknown state
  UNKNOWN = 'unknown',
}

export interface StateDetectionResult {
  state: ClaudeCodeState;
  confidence: number;
  reason: string;
  isWaiting: boolean;
  needsHuman: boolean;
}

interface StateIndicator {
  state: ClaudeCodeState;
  patterns: RegExp[];
  priority: number;
  confidence: number; // Variable confidence based on pattern specificity
}

/**
 * Priority-based state indicators
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const STATE_INDICATORS: StateIndicator[] = [
  // High priority: Active work states
  {
    state: ClaudeCodeState.THINKING,
    patterns: [/\(thinking\)/i, /(?:^|\s)(?:Concocting|Twisting|Considering|Analyzing)(?:\s|$)/i],
    priority: 100,
    confidence: 0.95, // High confidence - distinctive patterns
  },
  {
    state: ClaudeCodeState.TOOL_RUNNING,
    patterns: [
      /esc to interrupt/i,
      /(?:^|\s)(?:Running|Executing)(?:\s|:)/i,
      /\[.*\]\s+\d+%/i, // Progress bars
    ],
    priority: 100,
    confidence: 0.95, // High confidence - tool execution is clear
  },
  {
    state: ClaudeCodeState.PROCESSING,
    patterns: [/(?:^|\s)(?:Processing|Analyzing|Generating)(?:\s|\.\.\.)/i, /Please wait/i],
    priority: 90,
    confidence: 0.85, // Good confidence but less distinctive
  },

  // High priority: Blocked states requiring human intervention
  {
    state: ClaudeCodeState.AWAITING_SELECTION,
    patterns: [/Enter to select.*↑\/↓/i, /Use arrows to navigate/i, /Select an option:/i],
    priority: 90,
    confidence: 0.95, // Very clear selection UI
  },
  {
    state: ClaudeCodeState.ASKING_QUESTION,
    patterns: [
      /\?\s*$/m, // Line ending with question mark
      /Please (?:choose|select|confirm)\b/i,
      /Would you like to\b/i,
      /(?:^|\n)Do you want to\b/i,
    ],
    priority: 85,
    confidence: 0.8, // Medium confidence - questions can be contextual
  },
  {
    state: ClaudeCodeState.PLAN_APPROVAL,
    patterns: [
      /(?:approve|review|ready to (?:implement|proceed with)) (?:the |your )?plan/i,
      /ExitPlanMode/i,
      /plan (?:looks|ready)\b/i,
    ],
    priority: 90,
    confidence: 0.9, // High confidence - plan mode is specific
  },
  {
    state: ClaudeCodeState.PERMISSION_REQUIRED,
    patterns: [
      /permission(?:s)? (?:is )?required/i,
      /(?:^|\n)authorize\b/i,
      /Allow.*\[y\/n\]/i,
      /Approve.*\[y\/n\]/i,
      /Would you like to run the following command\?/i,
      /Yes,\s*proceed\s*\(y\)/i,
      /Press enter to confirm/i,
    ],
    priority: 90,
    confidence: 0.92, // High confidence - explicit permission prompts
  },
  {
    state: ClaudeCodeState.USER_DECLINED,
    patterns: [/(?:user |permission )?declined/i, /permission denied/i, /User chose not to/i],
    priority: 85,
    confidence: 0.9, // High confidence - explicit decline
  },

  // Lower priority: Ready/idle states
  {
    state: ClaudeCodeState.WORK_COMPLETE,
    patterns: [
      /(?:^|\n)(?:Task |Work |Implementation )(?:is )?(?:done|complete(?:d)?|finished)/i,
      /(?:^|\n)Successfully (?:completed|implemented|fixed)\b/i,
      /All (?:\d+ )?tests passed/i,
    ],
    priority: 50,
    confidence: 0.75, // Lower confidence - words can appear in other contexts
  },
  {
    state: ClaudeCodeState.IDLE_AT_PROMPT,
    patterns: [
      /^>\s*$/m, // Prompt alone on line
      /(?:^|\n)Ready for input/i,
      /(?:^|\n)What would you like (?:me to |to )?(?:do|work on)/i,
    ],
    priority: 40,
    confidence: 0.85, // Good confidence for idle state
  },
];

/**
 * Detect the current Claude Code UI state from output text
 *
 * @param output - The text output from Claude Code's UI
 * @param lastStateChangeTime - Timestamp of last state change (for timeout detection)
 * @param unknownTimeoutMs - Time to consider UNKNOWN state as potentially stuck (default: 120000ms = 2min)
 * @returns Detection result with state, confidence, and flags
 */
export function detectClaudeCodeState(
  output: string,
  lastStateChangeTime?: number,
  unknownTimeoutMs: number = 120000
): StateDetectionResult {
  // Sort indicators by priority (highest first)
  const sortedIndicators = [...STATE_INDICATORS].sort((a, b) => b.priority - a.priority);

  // Check each indicator in priority order
  for (const indicator of sortedIndicators) {
    for (const pattern of indicator.patterns) {
      if (pattern.test(output)) {
        const result = mapStateToWaitingStatus(indicator.state);
        return {
          ...result,
          confidence: indicator.confidence, // Use variable confidence per indicator
          reason: `Detected pattern for ${indicator.state}`,
        };
      }
    }
  }

  // No clear state detected - treat as potentially stuck if timeout exceeded
  const now = Date.now();
  const timeSinceChange = lastStateChangeTime ? now - lastStateChangeTime : 0;
  const isPotentiallyStuck = timeSinceChange > unknownTimeoutMs;

  return {
    state: ClaudeCodeState.UNKNOWN,
    confidence: 0.3,
    reason: isPotentiallyStuck
      ? `No state detected for ${Math.round(timeSinceChange / 1000)}s - potentially stuck`
      : 'No clear state indicators found',
    isWaiting: isPotentiallyStuck, // Treat as waiting if stuck for too long
    needsHuman: isPotentiallyStuck, // May need intervention if stuck
  };
}

/**
 * Map a Claude Code state to waiting status flags
 */
function mapStateToWaitingStatus(
  state: ClaudeCodeState
): Omit<StateDetectionResult, 'confidence' | 'reason'> {
  switch (state) {
    // Active states - not waiting
    case ClaudeCodeState.THINKING:
    case ClaudeCodeState.TOOL_RUNNING:
    case ClaudeCodeState.PROCESSING:
      return {
        state,
        isWaiting: false,
        needsHuman: false,
      };

    // Idle states - waiting but not blocked
    case ClaudeCodeState.IDLE_AT_PROMPT:
    case ClaudeCodeState.WORK_COMPLETE:
      return {
        state,
        isWaiting: true,
        needsHuman: false,
      };

    // Blocked states - waiting and needs human
    case ClaudeCodeState.ASKING_QUESTION:
    case ClaudeCodeState.AWAITING_SELECTION:
    case ClaudeCodeState.PLAN_APPROVAL:
    case ClaudeCodeState.PERMISSION_REQUIRED:
    case ClaudeCodeState.USER_DECLINED:
      return {
        state,
        isWaiting: true,
        needsHuman: true,
      };

    // Unknown state - assume not waiting
    case ClaudeCodeState.UNKNOWN:
    default:
      return {
        state,
        isWaiting: false,
        needsHuman: false,
      };
  }
}

/**
 * Get a human-readable description of a state
 */
export function getStateDescription(state: ClaudeCodeState): string {
  switch (state) {
    case ClaudeCodeState.THINKING:
      return 'Claude is thinking';
    case ClaudeCodeState.TOOL_RUNNING:
      return 'A tool is running';
    case ClaudeCodeState.PROCESSING:
      return 'Processing request';
    case ClaudeCodeState.IDLE_AT_PROMPT:
      return 'Idle at prompt';
    case ClaudeCodeState.WORK_COMPLETE:
      return 'Work completed';
    case ClaudeCodeState.ASKING_QUESTION:
      return 'Asking a question - needs response';
    case ClaudeCodeState.AWAITING_SELECTION:
      return 'Awaiting user selection';
    case ClaudeCodeState.PLAN_APPROVAL:
      return 'Waiting for plan approval';
    case ClaudeCodeState.PERMISSION_REQUIRED:
      return 'Permission required';
    case ClaudeCodeState.USER_DECLINED:
      return 'User declined - blocked';
    case ClaudeCodeState.UNKNOWN:
      return 'Unknown state';
    default:
      return 'Unknown';
  }
}

/**
 * Check if a state represents active work (not waiting)
 */
export function isActiveState(state: ClaudeCodeState): boolean {
  return [
    ClaudeCodeState.THINKING,
    ClaudeCodeState.TOOL_RUNNING,
    ClaudeCodeState.PROCESSING,
  ].includes(state);
}

/**
 * Check if a state requires human intervention
 */
export function isBlockedState(state: ClaudeCodeState): boolean {
  return [
    ClaudeCodeState.ASKING_QUESTION,
    ClaudeCodeState.AWAITING_SELECTION,
    ClaudeCodeState.PLAN_APPROVAL,
    ClaudeCodeState.PERMISSION_REQUIRED,
    ClaudeCodeState.USER_DECLINED,
  ].includes(state);
}
