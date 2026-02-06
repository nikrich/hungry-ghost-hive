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
export type { StateDetector, StateDetectionResult, CLIType } from './types.js';
export { AgentState } from './types.js';
export { ClaudeStateDetector } from './claude.js';
export { CodexStateDetector } from './codex.js';
export { GeminiStateDetector } from './gemini.js';
export { getStateDetector, isSupportedCLI } from './factory.js';
//# sourceMappingURL=index.d.ts.map