/**
 * Multi-CLI State Detection System
 *
 * Provides a pluggable interface for detecting the UI state of different
 * CLI agent tools (Claude Code, Codex CLI, Gemini CLI).
 */

/**
 * Agent state enum - shared across all CLI tools
 * Each detector maps CLI-specific output patterns to these states
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
 * Interface that all CLI state detectors must implement
 */
export interface StateDetector {
  /**
   * Detect the current state from CLI output
   * @param paneOutput - The text output from the CLI tool's UI
   * @returns Detection result with state, confidence, and flags
   */
  detectState(paneOutput: string): StateDetectionResult;

  /**
   * Get a human-readable description of a state
   * @param state - The agent state
   * @returns Human-readable description
   */
  getStateDescription(state: AgentState): string;

  /**
   * Check if a state represents active work (not waiting)
   * @param state - The agent state
   * @returns True if the agent is actively working
   */
  isActiveState(state: AgentState): boolean;

  /**
   * Check if a state requires human intervention
   * @param state - The agent state
   * @returns True if the agent is blocked and needs human input
   */
  isBlockedState(state: AgentState): boolean;
}

/**
 * CLI tool types supported by the state detection system
 */
export type CliTool = 'claude' | 'codex' | 'gemini';
