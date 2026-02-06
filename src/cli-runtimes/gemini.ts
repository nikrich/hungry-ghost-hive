import { CliRuntimeBuilder, SpawnOptions } from './types.js';

/**
 * Google Gemini CLI runtime builder
 * Generates commands for the Gemini CLI tool
 */
export class GeminiRuntime implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, options?: SpawnOptions): string {
    const flags: string[] = ['gemini'];

    flags.push(this.getModelFlag(model));

    if (options?.autoApprove) {
      flags.push(this.getAutoApprovalFlag());
    }

    return flags.join(' ');
  }

  buildResumeCommand(sessionId: string): string {
    return `gemini --resume ${sessionId}`;
  }

  getAutoApprovalFlag(): string {
    // Gemini may use --auto-approve or similar flag
    return '--auto-approve';
  }

  getModelFlag(model: string): string {
    return `--model ${model}`;
  }
}
