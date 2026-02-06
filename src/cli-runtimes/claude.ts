import { CliRuntimeBuilder, SpawnOptions } from './types.js';

/**
 * Claude Code CLI runtime builder
 * Generates commands for the Claude Code CLI tool
 */
export class ClaudeRuntime implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, options?: SpawnOptions): string {
    const flags: string[] = ['claude'];

    // Claude Code specific flags
    flags.push('--dangerously-skip-permissions');
    flags.push(this.getModelFlag(model));

    if (options?.autoApprove) {
      flags.push(this.getAutoApprovalFlag());
    }

    return flags.join(' ');
  }

  buildResumeCommand(sessionId: string): string {
    return `claude --resume ${sessionId}`;
  }

  getAutoApprovalFlag(): string {
    // Claude Code may not have a built-in auto-approval flag
    // This would need to be handled through other means (e.g., environment variables)
    return '';
  }

  getModelFlag(model: string): string {
    return `--model ${model}`;
  }
}
