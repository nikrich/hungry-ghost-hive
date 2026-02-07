// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * State Detector Factory
 *
 * Factory function to create the appropriate state detector based on CLI type
 */

import { UnsupportedFeatureError } from '../errors/index.js';
import { ClaudeStateDetector } from './claude.js';
import { CodexStateDetector } from './codex.js';
import { GeminiStateDetector } from './gemini.js';
import { CLIType, StateDetector } from './types.js';

/**
 * Get the appropriate state detector for the specified CLI type
 *
 * @param cliType - The type of CLI to get a detector for
 * @returns StateDetector instance for the specified CLI
 * @throws Error if the CLI type is not supported
 */
export function getStateDetector(cliType: CLIType): StateDetector {
  switch (cliType) {
    case 'claude':
      return new ClaudeStateDetector();
    case 'codex':
      return new CodexStateDetector();
    case 'gemini':
      return new GeminiStateDetector();
    default:
      throw new UnsupportedFeatureError(`Unsupported CLI type: ${cliType}`);
  }
}

/**
 * Check if a CLI type is supported
 *
 * @param cliType - The CLI type to check
 * @returns True if the CLI type is supported
 */
export function isSupportedCLI(cliType: string): cliType is CLIType {
  return ['claude', 'codex', 'gemini'].includes(cliType);
}
