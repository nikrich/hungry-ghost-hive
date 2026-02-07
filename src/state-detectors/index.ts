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
export { AgentState } from './types.js';
export type { CLIType, StateDetectionResult, StateDetector } from './types.js';

// Export base class and shared types
export { BaseStateDetector } from './base.js';
export type { StateIndicator } from './base.js';

// Export state detector implementations
export { ClaudeStateDetector } from './claude.js';
export { CodexStateDetector } from './codex.js';
export { GeminiStateDetector } from './gemini.js';

// Export factory functions
export { getStateDetector, isSupportedCLI } from './factory.js';
