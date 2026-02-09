// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { CliRuntimeBuilder, RuntimeSafetyMode } from './types.js';

export class CodexRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, safetyMode: RuntimeSafetyMode): string[] {
    const approvalPolicy = safetyMode === 'safe' ? 'on-request' : 'never';
    return [
      'codex',
      '--ask-for-approval',
      approvalPolicy,
      '--sandbox',
      'workspace-write',
      '--model',
      model,
    ];
  }

  buildResumeCommand(model: string, sessionId: string, safetyMode: RuntimeSafetyMode): string[] {
    const approvalPolicy = safetyMode === 'safe' ? 'on-request' : 'never';
    return [
      'codex',
      '--ask-for-approval',
      approvalPolicy,
      '--sandbox',
      'workspace-write',
      '--model',
      model,
      '--resume',
      sessionId,
    ];
  }

  getAutoApprovalFlag(safetyMode: RuntimeSafetyMode): string {
    return safetyMode === 'safe' ? '--ask-for-approval on-request' : '--ask-for-approval never';
  }

  getModelFlag(): string {
    return '--model';
  }
}
