// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Multi-CLI Agent State Detection Types
 *
 * Defines common state detection interfaces and types that work across
 * different CLI tools (Claude Code, Codex, Gemini, etc.)
 */

/**
 * Universal agent states that apply across different CLI tools
 */
export enum AgentState {
  // Active states - agent is actively working
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

/**
 * Result of state detection with confidence and metadata
 */
export interface StateDetectionResult {
  state: AgentState;
  confidence: number;
  reason: string;
  isWaiting: boolean;
  needsHuman: boolean;
}

/**
 * Interface for CLI-specific state detectors
 * Each CLI tool implements this interface with its own patterns
 */
export interface StateDetector {
  /**
   * Detect the current state from CLI output
   * @param output - The text output from the CLI
   * @returns Detection result with state, confidence, and flags
   */
  detectState(output: string): StateDetectionResult;

  /**
   * Get a human-readable description of a state
   * @param state - The state to describe
   * @returns Human-readable description
   */
  getStateDescription(state: AgentState): string;

  /**
   * Check if a state represents active work (not waiting)
   * @param state - The state to check
   * @returns True if the state is active
   */
  isActiveState(state: AgentState): boolean;

  /**
   * Check if a state requires human intervention
   * @param state - The state to check
   * @returns True if the state is blocked
   */
  isBlockedState(state: AgentState): boolean;
}

/**
 * Type identifier for different CLI tools
 */
export type CLIType = 'claude' | 'codex' | 'gemini';
