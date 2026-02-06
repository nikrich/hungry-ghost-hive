/**
 * Gemini CLI State Detector
 *
 * Detects the UI state of Gemini CLI based on output patterns
 * Note: These patterns are based on common CLI patterns and may need adjustment
 * based on actual Gemini CLI output behavior
 */
import { AgentState, StateDetectionResult, StateDetector } from './types.js';
/**
 * Gemini CLI State Detector Implementation
 */
export declare class GeminiStateDetector implements StateDetector {
    /**
     * Detect the current Gemini CLI state from output text
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
//# sourceMappingURL=gemini.d.ts.map