import { CliRuntimeBuilder } from './types.js';

export class GeminiRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(model: string): string[] {
    return [
      'gemini',
      '--model',
      model,
      '--sandbox',
      'none',
    ];
  }

  buildResumeCommand(model: string, sessionId: string): string[] {
    return [
      'gemini',
      '--model',
      model,
      '--sandbox',
      'none',
      '--resume',
      sessionId,
    ];
  }

  getAutoApprovalFlag(): string {
    return '--sandbox';
  }

  getModelFlag(): string {
    return '--model';
  }
}
