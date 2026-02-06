/**
 * Multi-CLI State Detection System
 *
 * Provides unified state detection across different CLI tools:
 * - Claude Code
 * - Codex CLI
 * - Gemini CLI
 *
 * Usage:
 *   import { getStateDetector } from './state-detectors';
 *   const detector = getStateDetector('claude');
 *   const result = detector.detectState(output);
 */

// Export types and interfaces
export type { StateDetector, StateDetectionResult, CLIType } from './types';
export { AgentState } from './types';

// Export state detector implementations
export { ClaudeStateDetector } from './claude';
export { CodexStateDetector } from './codex';
export { GeminiStateDetector } from './gemini';

// Export factory functions
export { getStateDetector, isSupportedCLI } from './factory';
