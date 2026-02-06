import { CliRuntimeBuilder, SpawnOptions } from './types.js';
export class ClaudeRuntime implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, options?: SpawnOptions): string {
    const flags = ['claude', '--dangerously-skip-permissions', `--model ${model}`];
    return flags.join(' ');
  }
  buildResumeCommand(sessionId: string): string { return `claude --resume ${sessionId}`; }
  getAutoApprovalFlag(): string { return ''; }
  getModelFlag(model: string): string { return `--model ${model}`; }
}
