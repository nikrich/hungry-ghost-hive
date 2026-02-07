import { execa } from 'execa';
import { UnsupportedFeatureError, ValidationError } from '../errors/index.js';
import { ClaudeRuntimeBuilder } from './claude.js';
import { CodexRuntimeBuilder } from './codex.js';
import { GeminiRuntimeBuilder } from './gemini.js';
import { CliRuntimeBuilder, CliRuntimeType } from './types.js';

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
      throw new UnsupportedFeatureError(`Unknown CLI runtime type: ${runtimeType}`);
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
  } catch (_error) {
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
 * Validate that a model is compatible with a CLI tool
 * @param model - The model string (e.g., 'gpt-4o-mini', 'claude-sonnet-4-5')
 * @param cliTool - The CLI tool to use (claude, codex, gemini)
 * @throws Error if the model and CLI tool are incompatible
 */
export function validateModelCliCompatibility(model: string, cliTool: CliRuntimeType): void {
  const modelLower = model.toLowerCase();

  // Claude CLI works only with Claude models
  if (cliTool === 'claude') {
    if (!modelLower.includes('claude')) {
      throw new ValidationError(
        `Model "${model}" is incompatible with CLI tool "claude". ` +
          `Claude CLI only works with Claude models (e.g., claude-opus, claude-sonnet, claude-haiku). ` +
          `For OpenAI models, use cli_tool: 'codex'. For Google Gemini models, use cli_tool: 'gemini'.`
      );
    }
  }

  // Codex CLI works with OpenAI models
  if (cliTool === 'codex') {
    if (!modelLower.includes('gpt') && !modelLower.includes('openai')) {
      throw new ValidationError(
        `Model "${model}" is incompatible with CLI tool "codex". ` +
          `Codex CLI works with OpenAI models (e.g., gpt-4, gpt-4o-mini). ` +
          `For Claude models, use cli_tool: 'claude'. For Google Gemini models, use cli_tool: 'gemini'.`
      );
    }
  }

  // Gemini CLI works with Google Gemini models
  if (cliTool === 'gemini') {
    if (!modelLower.includes('gemini')) {
      throw new ValidationError(
        `Model "${model}" is incompatible with CLI tool "gemini". ` +
          `Gemini CLI only works with Google Gemini models (e.g., gemini-pro). ` +
          `For Claude models, use cli_tool: 'claude'. For OpenAI models, use cli_tool: 'codex'.`
      );
    }
  }
}

export { ClaudeRuntimeBuilder } from './claude.js';
export { CodexRuntimeBuilder } from './codex.js';
export { GeminiRuntimeBuilder } from './gemini.js';
export type { CliRuntimeBuilder, CliRuntimeType };
