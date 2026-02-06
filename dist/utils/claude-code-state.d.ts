/**
 * Claude Code UI State Detection
 *
 * Provides robust state machine-based detection of Claude Code's UI state
 * to determine when agents are blocked and need human intervention.
 */
export declare enum ClaudeCodeState {
    THINKING = "thinking",
    TOOL_RUNNING = "tool_running",
    PROCESSING = "processing",
    IDLE_AT_PROMPT = "idle_at_prompt",
    WORK_COMPLETE = "work_complete",
    ASKING_QUESTION = "asking_question",
    AWAITING_SELECTION = "awaiting_selection",
    PLAN_APPROVAL = "plan_approval",
    PERMISSION_REQUIRED = "permission_required",
    USER_DECLINED = "user_declined",
    UNKNOWN = "unknown"
}
export interface StateDetectionResult {
    state: ClaudeCodeState;
    confidence: number;
    reason: string;
    isWaiting: boolean;
    needsHuman: boolean;
}
/**
 * Detect the current Claude Code UI state from output text
 *
 * @param output - The text output from Claude Code's UI
 * @returns Detection result with state, confidence, and flags
 */
export declare function detectClaudeCodeState(output: string): StateDetectionResult;
/**
 * Get a human-readable description of a state
 */
export declare function getStateDescription(state: ClaudeCodeState): string;
/**
 * Check if a state represents active work (not waiting)
 */
export declare function isActiveState(state: ClaudeCodeState): boolean;
/**
 * Check if a state requires human intervention
 */
export declare function isBlockedState(state: ClaudeCodeState): boolean;
//# sourceMappingURL=claude-code-state.d.ts.map