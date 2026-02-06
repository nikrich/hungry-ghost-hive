/**
 * Codex CLI State Detector
 *
 * Detects the UI state of Codex CLI based on output patterns
 * Note: These patterns are based on common CLI patterns and may need adjustment
 * based on actual Codex CLI output behavior
 */
import { AgentState, StateDetectionResult, StateDetector } from './types.js';
/**
 * Codex CLI State Detector Implementation
 */
export declare class CodexStateDetector implements StateDetector {
    /**
     * Detect the current Codex CLI state from output text
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
//# sourceMappingURL=codex.d.ts.map