export interface CliRuntimeBuilder {
  buildSpawnCommand(model: string, options?: SpawnOptions): string;
  buildResumeCommand(sessionId: string): string;
  getAutoApprovalFlag(): string;
  getModelFlag(model: string): string;
}
export interface SpawnOptions {
  autoApprove?: boolean;
  env?: Record<string, string>;
  cwd?: string;
}
export type CliRuntimeType = 'claude' | 'codex' | 'gemini';
