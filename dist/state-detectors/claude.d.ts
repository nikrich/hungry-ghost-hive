/**
 * Claude Code State Detector
 *
 * Detects the UI state of Claude Code CLI based on output patterns
 * Refactored from src/utils/claude-code-state.ts
 */
import { AgentState, StateDetectionResult, StateDetector } from './types.js';
/**
 * Claude Code State Detector Implementation
 */
export declare class ClaudeStateDetector implements StateDetector {
    /**
     * Detect the current Claude Code UI state from output text
     */
    detectState(output: string): StateDetectionResult;
    /**
     * Get a human-readable description of a state
     */
    getStateDescription(state: AgentState): string;
    /**
     * Check if a state represents active work (not waiting)
     */
    isActiveState(state: AgentState): boolean;
    /**
     * Check if a state requires human intervention
     */
    isBlockedState(state: AgentState): boolean;
    /**
     * Map a state to waiting status flags
     */
    private mapStateToWaitingStatus;
}
//# sourceMappingURL=claude.d.ts.map