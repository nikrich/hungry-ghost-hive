// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { CliRuntimeBuilder, RuntimeOptions, RuntimeSafetyMode } from './types.js';

export class CodexRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(
    model: string,
    safetyMode: RuntimeSafetyMode,
    _options?: RuntimeOptions
  ): string[] {
    const approvalPolicy = safetyMode === 'safe' ? 'on-request' : 'never';
    const sandboxMode = safetyMode === 'safe' ? 'workspace-write' : 'danger-full-access';
    return [
      'codex',
      '--ask-for-approval',
      approvalPolicy,
      '--sandbox',
      sandboxMode,
      '--model',
      model,
    ];
  }

  buildResumeCommand(
    model: string,
    sessionId: string,
    safetyMode: RuntimeSafetyMode,
    _options?: RuntimeOptions
  ): string[] {
    const approvalPolicy = safetyMode === 'safe' ? 'on-request' : 'never';
    const sandboxMode = safetyMode === 'safe' ? 'workspace-write' : 'danger-full-access';
    return [
      'codex',
      'resume',
      '--ask-for-approval',
      approvalPolicy,
      '--sandbox',
      sandboxMode,
      '--model',
      model,
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
