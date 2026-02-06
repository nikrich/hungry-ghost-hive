import { execa } from 'execa';
import { CliRuntimeType, CliRuntimeBuilder } from './types.js';
import { ClaudeRuntimeBuilder } from './claude.js';
import { CodexRuntimeBuilder } from './codex.js';
import { GeminiRuntimeBuilder } from './gemini.js';

/**
 * Factory function to get the appropriate CLI runtime builder
 * @param runtimeType - The type of CLI runtime to use
 * @returns The corresponding runtime builder instance
 * @throws Error if the runtime type is unknown
 */
export function getCliRuntimeBuilder(runtimeType: CliRuntimeType): CliRuntimeBuilder {
  switch (runtimeType) {
    case 'claude':
      return new ClaudeRuntimeBuilder();
    case 'codex':
      return new CodexRuntimeBuilder();
    case 'gemini':
      return new GeminiRuntimeBuilder();
    default:
      throw new Error(`Unknown CLI runtime type: ${runtimeType}`);
  }
}

/**
 * Validate that a CLI binary is available in the system PATH
 * @param binary - The name of the binary to check
 * @returns Promise that resolves to true if binary exists, false otherwise
 */
export async function validateCliBinary(binary: string): Promise<boolean> {
  try {
    await execa('which', [binary]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that the CLI runtime binary is available
 * @param runtimeType - The type of CLI runtime to validate
 * @returns Promise that resolves to true if binary exists, false otherwise
 */
export async function validateCliRuntime(runtimeType: CliRuntimeType): Promise<boolean> {
  return validateCliBinary(runtimeType);
}

/**
 * Validate that a CLI tool is compatible with a model provider
 * @param cliTool - The CLI tool type (claude, codex, gemini)
 * @param provider - The model provider (anthropic, openai, google)
 * @throws Error if the CLI tool is not compatible with the provider
 */
export function validateCliToolCompatibility(cliTool: CliRuntimeType, provider: string): void {
  const compatibilityMap: Record<CliRuntimeType, string[]> = {
    claude: ['anthropic'],
    codex: ['openai'],
    gemini: ['google'],
  };

  const supportedProviders = compatibilityMap[cliTool];
  if (!supportedProviders.includes(provider)) {
    throw new Error(
      `CLI tool '${cliTool}' is not compatible with provider '${provider}'. ` +
      `Supported providers for '${cliTool}': ${supportedProviders.join(', ')}`
    );
  }
}

export type { CliRuntimeType, CliRuntimeBuilder };
export { ClaudeRuntimeBuilder } from './claude.js';
export { CodexRuntimeBuilder } from './codex.js';
export { GeminiRuntimeBuilder } from './gemini.js';
