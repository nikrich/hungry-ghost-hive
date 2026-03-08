// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execa } from 'execa';
import type { CliRuntimeType } from './types.js';

/**
 * Detect whether the Claude CLI supports the --chrome flag.
 * Runs `claude --help` and checks if the output mentions --chrome.
 * @returns true if --chrome is recognized by the CLI
 */
export async function detectChromeAvailability(): Promise<boolean> {
  try {
    const result = await execa('claude', ['--help']);
    const output = result.stdout + result.stderr;
    return output.includes('--chrome');
  } catch {
    return false;
  }
}

/**
 * Resolve the effective chrome enabled state from config value.
 * - true/false: use the explicit value
 * - 'auto': detect availability, but only enable for claude CLI tool
 * @param configValue - The chrome_enabled config value (true, false, or 'auto')
 * @param cliTool - The CLI tool configured for the agent
 * @returns Whether chrome should be enabled
 */
export async function resolveChromeEnabled(
  configValue: boolean | 'auto',
  cliTool: CliRuntimeType
): Promise<boolean> {
  if (typeof configValue === 'boolean') {
    return configValue;
  }

  // Auto-detect: only enable for claude CLI tool
  if (cliTool !== 'claude') {
    return false;
  }

  return detectChromeAvailability();
}
