import { CliRuntimeBuilder, SpawnOptions } from './types.js';
export class CodexRuntime implements CliRuntimeBuilder {
  buildSpawnCommand(model: string): string { return `codex --full-auto --model ${model}`; }
  buildResumeCommand(sessionId: string): string { return `codex --full-auto --resume ${sessionId}`; }
  getAutoApprovalFlag(): string { return '--full-auto'; }
  getModelFlag(model: string): string { return `--model ${model}`; }
}
