import { CliRuntimeBuilder, SpawnOptions } from './types.js';

/**
 * OpenAI Codex CLI runtime builder
 * Generates commands for the Codex CLI tool
 */
export class CodexRuntime implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, options?: SpawnOptions): string {
    const flags: string[] = ['codex'];

    // Codex auto-approval flag
    flags.push('--full-auto');
    flags.push(this.getModelFlag(model));

    if (options?.autoApprove) {
      // --full-auto already enables auto-approval for Codex
    }

    return flags.join(' ');
  }

  buildResumeCommand(sessionId: string): string {
    return `codex --full-auto --resume ${sessionId}`;
  }

  getAutoApprovalFlag(): string {
    return '--full-auto';
  }

  getModelFlag(model: string): string {
    return `--model ${model}`;
  }
}
