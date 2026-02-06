import { CliRuntimeBuilder } from './types.js';

export class ClaudeRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(model: string): string[] {
    return [
      'claude',
      '--dangerously-skip-permissions',
      '--model',
      model,
    ];
  }

  buildResumeCommand(model: string, sessionId: string): string[] {
    return [
      'claude',
      '--dangerously-skip-permissions',
      '--model',
      model,
      '--resume',
      sessionId,
    ];
  }

  getAutoApprovalFlag(): string {
    return '--dangerously-skip-permissions';
  }

  getModelFlag(): string {
    return '--model';
  }
}
