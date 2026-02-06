import { execSync } from 'child_process';
import { CliRuntimeType, CliRuntimeBuilder } from './types.js';
import { ClaudeRuntime } from './claude.js';
import { CodexRuntime } from './codex.js';
import { GeminiRuntime } from './gemini.js';
export function getCliRuntime(cliTool: CliRuntimeType): CliRuntimeBuilder {
  validateCliBinary(cliTool);
  switch (cliTool) {
    case 'claude': return new ClaudeRuntime();
    case 'codex': return new CodexRuntime();
    case 'gemini': return new GeminiRuntime();
    default: throw new Error(`Unsupported CLI tool: ${cliTool}`);
  }
}
function validateCliBinary(cliTool: CliRuntimeType): void {
  try { execSync(`which ${cliTool}`, { stdio: 'pipe' }); }
  catch { throw new Error(`CLI binary '${cliTool}' not found in PATH`); }
}
export { ClaudeRuntime, CodexRuntime, GeminiRuntime };
export type { CliRuntimeBuilder, SpawnOptions, CliRuntimeType } from './types.js';
