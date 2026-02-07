/**
 * Base State Detector
 *
 * Abstract base class that consolidates shared logic across all CLI state detectors.
 * Subclasses only need to provide CLI-specific patterns and descriptions.
 */

import { AgentState, StateDetectionResult, StateDetector } from './types.js';

export interface StateIndicator {
  state: AgentState;
  patterns: RegExp[];
  priority: number;
}

/**
 * Abstract base class for CLI state detectors.
 * Provides the shared detection algorithm, active/blocked state checks,
 * and waiting status mapping. Subclasses supply CLI-specific indicators
 * and state descriptions.
 */
export abstract class BaseStateDetector implements StateDetector {
  constructor(
    protected readonly cliName: string,
    protected readonly defaultConfidence: number
  ) {}

  /**
   * Return the CLI-specific state indicators (patterns + priorities).
   */
  protected abstract getIndicators(): StateIndicator[];

  /**
   * Get a human-readable description of a state.
   */
  abstract getStateDescription(state: AgentState): string;

  /**
   * Detect the current CLI state from output text.
   */
  detectState(output: string): StateDetectionResult {
    const sortedIndicators = [...this.getIndicators()].sort((a, b) => b.priority - a.priority);

    for (const indicator of sortedIndicators) {
      for (const pattern of indicator.patterns) {
        if (pattern.test(output)) {
          const result = this.mapStateToWaitingStatus(indicator.state);
          return {
            ...result,
            confidence: this.defaultConfidence,
            reason: `Detected ${this.cliName} pattern for ${indicator.state}`,
          };
        }
      }
    }

    return {
      state: AgentState.UNKNOWN,
      confidence: 0.3,
      reason: `No clear ${this.cliName} state indicators found`,
      isWaiting: false,
      needsHuman: false,
    };
  }

  /**
   * Check if a state represents active work (not waiting).
   */
  isActiveState(state: AgentState): boolean {
    return [AgentState.THINKING, AgentState.TOOL_RUNNING, AgentState.PROCESSING].includes(state);
  }

  /**
   * Check if a state requires human intervention.
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
   * Map a state to waiting status flags.
   */
  protected mapStateToWaitingStatus(
    state: AgentState
  ): Omit<StateDetectionResult, 'confidence' | 'reason'> {
    switch (state) {
      case AgentState.THINKING:
      case AgentState.TOOL_RUNNING:
      case AgentState.PROCESSING:
        return { state, isWaiting: false, needsHuman: false };

      case AgentState.IDLE_AT_PROMPT:
      case AgentState.WORK_COMPLETE:
        return { state, isWaiting: true, needsHuman: false };

      case AgentState.ASKING_QUESTION:
      case AgentState.AWAITING_SELECTION:
      case AgentState.PLAN_APPROVAL:
      case AgentState.PERMISSION_REQUIRED:
      case AgentState.USER_DECLINED:
        return { state, isWaiting: true, needsHuman: true };

      case AgentState.UNKNOWN:
      default:
        return { state, isWaiting: false, needsHuman: false };
    }
  }
}
