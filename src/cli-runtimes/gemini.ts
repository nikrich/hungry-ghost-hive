import { CliRuntimeBuilder, SpawnOptions } from './types.js';
export class GeminiRuntime implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, options?: SpawnOptions): string {
    const flags = ['gemini', `--model ${model}`];
    if (options?.autoApprove) flags.push('--auto-approve');
    return flags.join(' ');
  }
  buildResumeCommand(sessionId: string): string { return `gemini --resume ${sessionId}`; }
  getAutoApprovalFlag(): string { return '--auto-approve'; }
  getModelFlag(model: string): string { return `--model ${model}`; }
}
