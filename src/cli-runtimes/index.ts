import { execSync } from 'child_process';
import { CliRuntimeType, CliRuntimeBuilder } from './types.js';
import { ClaudeRuntime } from './claude.js';
import { CodexRuntime } from './codex.js';
import { GeminiRuntime } from './gemini.js';

/**
 * Get a CLI runtime builder for the specified CLI tool
 * @param cliTool The CLI tool to use ('claude', 'codex', or 'gemini')
 * @returns The CLI runtime builder instance
 * @throws Error if the CLI tool is not supported or binary is not found
 */
export function getCliRuntime(cliTool: CliRuntimeType): CliRuntimeBuilder {
  // Validate that the CLI binary is available
  validateCliBinary(cliTool);

  switch (cliTool) {
    case 'claude':
      return new ClaudeRuntime();
    case 'codex':
      return new CodexRuntime();
    case 'gemini':
      return new GeminiRuntime();
    default:
      throw new Error(`Unsupported CLI tool: ${cliTool}`);
  }
}

/**
 * Validate that a CLI binary is available on the system
 * @param cliTool The CLI tool name
 * @throws Error with helpful message if binary is not found
 */
function validateCliBinary(cliTool: CliRuntimeType): void {
  try {
    // Use 'which' command to check if binary exists
    execSync(`which ${cliTool}`, { stdio: 'pipe' });
  } catch {
    throw new Error(
      `CLI binary '${cliTool}' not found in PATH. ` +
      `Please install ${getInstallationInstructions(cliTool)}`
    );
  }
}

/**
 * Get installation instructions for a CLI tool
 * @param cliTool The CLI tool name
 * @returns Installation instructions
 */
function getInstallationInstructions(cliTool: CliRuntimeType): string {
  const instructions: Record<CliRuntimeType, string> = {
    claude:
      'Claude Code CLI. See https://github.com/anthropics/claude-code for installation.',
    codex: 'OpenAI Codex CLI. See https://github.com/openai/codex for installation.',
    gemini: 'Google Gemini CLI. See https://cloud.google.com/docs/gemini for installation.',
  };

  return instructions[cliTool] || `the ${cliTool} CLI tool`;
}

// Export runtime classes for direct use if needed
export { ClaudeRuntime } from './claude.js';
export { CodexRuntime } from './codex.js';
export { GeminiRuntime } from './gemini.js';
export type { CliRuntimeBuilder, SpawnOptions, CliRuntimeType } from './types.js';
