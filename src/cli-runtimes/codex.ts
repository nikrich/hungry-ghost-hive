import { CliRuntimeBuilder } from './types.js';

export class CodexRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(model: string): string[] {
    return [
      'codex',
      '--full-auto',
      '--model',
      model,
    ];
  }

  buildResumeCommand(model: string, sessionId: string): string[] {
    return [
      'codex',
      '--full-auto',
      '--model',
      model,
      '--resume',
      sessionId,
    ];
  }

  getAutoApprovalFlag(): string {
    return '--full-auto';
  }

  getModelFlag(): string {
    return '--model';
  }
}
