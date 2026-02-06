/**
 * Claude Code UI State Detection
 *
 * Provides robust state machine-based detection of Claude Code's UI state
 * to determine when agents are blocked and need human intervention.
 */
export var ClaudeCodeState;
(function (ClaudeCodeState) {
    // Active states - Claude is actively working
    ClaudeCodeState["THINKING"] = "thinking";
    ClaudeCodeState["TOOL_RUNNING"] = "tool_running";
    ClaudeCodeState["PROCESSING"] = "processing";
    // Waiting states - idle at prompt, ready for input
    ClaudeCodeState["IDLE_AT_PROMPT"] = "idle_at_prompt";
    ClaudeCodeState["WORK_COMPLETE"] = "work_complete";
    // Blocked states - requires human intervention
    ClaudeCodeState["ASKING_QUESTION"] = "asking_question";
    ClaudeCodeState["AWAITING_SELECTION"] = "awaiting_selection";
    ClaudeCodeState["PLAN_APPROVAL"] = "plan_approval";
    ClaudeCodeState["PERMISSION_REQUIRED"] = "permission_required";
    ClaudeCodeState["USER_DECLINED"] = "user_declined";
    // Unknown state
    ClaudeCodeState["UNKNOWN"] = "unknown";
})(ClaudeCodeState || (ClaudeCodeState = {}));
/**
 * Priority-based state indicators
 * Higher priority patterns are checked first to handle overlapping indicators
 */
const STATE_INDICATORS = [
    // High priority: Active work states
    {
        state: ClaudeCodeState.THINKING,
        patterns: [
            /\(thinking\)/i,
            /Concocting|Twisting|Considering|Analyzing/i,
        ],
        priority: 100,
    },
    {
        state: ClaudeCodeState.TOOL_RUNNING,
        patterns: [
            /esc to interrupt/i,
            /Running|Executing/i,
            /\[.*\]\s+\d+%/i, // Progress bars
        ],
        priority: 100,
    },
    {
        state: ClaudeCodeState.PROCESSING,
        patterns: [
            /Processing|Analyzing|Generating/i,
            /Please wait/i,
        ],
        priority: 90,
    },
    // High priority: Blocked states requiring human intervention
    {
        state: ClaudeCodeState.AWAITING_SELECTION,
        patterns: [
            /Enter to select.*↑\/↓/i,
            /Use arrows to navigate/i,
            /Select an option/i,
        ],
        priority: 90,
    },
    {
        state: ClaudeCodeState.ASKING_QUESTION,
        patterns: [
            /\?\s*$/m, // Line ending with question mark
            /Please (choose|select|confirm)/i,
            /Would you like to/i,
            /Do you want to/i,
        ],
        priority: 85,
    },
    {
        state: ClaudeCodeState.PLAN_APPROVAL,
        patterns: [
            /approve.*plan/i,
            /review.*plan/i,
            /proceed.*plan/i,
            /ExitPlanMode/i,
        ],
        priority: 90,
    },
    {
        state: ClaudeCodeState.PERMISSION_REQUIRED,
        patterns: [
            /permission.*required/i,
            /authorize/i,
            /Allow.*\[y\/n\]/i,
            /Approve.*\[y\/n\]/i,
        ],
        priority: 90,
    },
    {
        state: ClaudeCodeState.USER_DECLINED,
        patterns: [
            /declined/i,
            /permission denied/i,
            /User chose not to/i,
        ],
        priority: 85,
    },
    // Lower priority: Ready/idle states
    {
        state: ClaudeCodeState.WORK_COMPLETE,
        patterns: [
            /done|complete|finished/i,
            /successfully/i,
            /All.*tests passed/i,
        ],
        priority: 50,
    },
    {
        state: ClaudeCodeState.IDLE_AT_PROMPT,
        patterns: [
            /^>\s*$/m, // Prompt alone on line
            /Ready for input/i,
            /What would you like/i,
        ],
        priority: 40,
    },
];
/**
 * Detect the current Claude Code UI state from output text
 *
 * @param output - The text output from Claude Code's UI
 * @returns Detection result with state, confidence, and flags
 */
export function detectClaudeCodeState(output) {
    // Sort indicators by priority (highest first)
    const sortedIndicators = [...STATE_INDICATORS].sort((a, b) => b.priority - a.priority);
    // Check each indicator in priority order
    for (const indicator of sortedIndicators) {
        for (const pattern of indicator.patterns) {
            if (pattern.test(output)) {
                const result = mapStateToWaitingStatus(indicator.state);
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
        state: ClaudeCodeState.UNKNOWN,
        confidence: 0.3,
        reason: 'No clear state indicators found',
        isWaiting: false,
        needsHuman: false,
    };
}
/**
 * Map a Claude Code state to waiting status flags
 */
function mapStateToWaitingStatus(state) {
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
export function getStateDescription(state) {
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
export function isActiveState(state) {
    return [
        ClaudeCodeState.THINKING,
        ClaudeCodeState.TOOL_RUNNING,
        ClaudeCodeState.PROCESSING,
    ].includes(state);
}
/**
 * Check if a state requires human intervention
 */
export function isBlockedState(state) {
    return [
        ClaudeCodeState.ASKING_QUESTION,
        ClaudeCodeState.AWAITING_SELECTION,
        ClaudeCodeState.PLAN_APPROVAL,
        ClaudeCodeState.PERMISSION_REQUIRED,
        ClaudeCodeState.USER_DECLINED,
    ].includes(state);
}
//# sourceMappingURL=claude-code-state.js.map