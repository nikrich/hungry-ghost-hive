/**
 * State Detector Factory
 */

import { StateDetector, CliTool } from './types.js';
import { ClaudeStateDetector } from './claude.js';
import { CodexStateDetector } from './codex.js';
import { GeminiStateDetector } from './gemini.js';

const cache: Partial<Record<CliTool, StateDetector>> = {};

export function getStateDetector(cliTool: CliTool = 'claude'): StateDetector {
  if (cache[cliTool]) return cache[cliTool]!;

  let detector: StateDetector;
  switch (cliTool) {
    case 'claude': detector = new ClaudeStateDetector(); break;
    case 'codex': detector = new CodexStateDetector(); break;
    case 'gemini': detector = new GeminiStateDetector(); break;
    default: throw new Error(`Unsupported CLI tool: ${cliTool}`);
  }

  cache[cliTool] = detector;
  return detector;
}

export function clearDetectorCache(): void {
  Object.keys(cache).forEach(k => delete cache[k as CliTool]);
}
