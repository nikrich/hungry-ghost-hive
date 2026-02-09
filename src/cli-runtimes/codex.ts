// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { CliRuntimeBuilder } from './types.js';

export class CodexRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(model: string): string[] {
    return ['codex', '--ask-for-approval', 'never', '--sandbox', 'workspace-write', '--model', model];
  }

  buildResumeCommand(model: string, sessionId: string): string[] {
    return [
      'codex',
      '--ask-for-approval',
      'never',
      '--sandbox',
      'workspace-write',
      '--model',
      model,
      '--resume',
      sessionId,
    ];
  }

  getAutoApprovalFlag(): string {
    return '--ask-for-approval never';
  }

  getModelFlag(): string {
    return '--model';
  }
}
