// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { CliRuntimeBuilder, RuntimeOptions, RuntimeSafetyMode } from './types.js';

export class GeminiRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(
    model: string,
    safetyMode: RuntimeSafetyMode,
    _options?: RuntimeOptions
  ): string[] {
    const sandboxMode = safetyMode === 'safe' ? 'workspace-write' : 'none';
    return ['gemini', '--model', model, '--sandbox', sandboxMode];
  }

  buildResumeCommand(
    model: string,
    sessionId: string,
    safetyMode: RuntimeSafetyMode,
    _options?: RuntimeOptions
  ): string[] {
    const sandboxMode = safetyMode === 'safe' ? 'workspace-write' : 'none';
    return ['gemini', '--model', model, '--sandbox', sandboxMode, '--resume', sessionId];
  }

  getAutoApprovalFlag(safetyMode: RuntimeSafetyMode): string {
    return safetyMode === 'safe' ? '--sandbox workspace-write' : '--sandbox none';
  }

  getModelFlag(): string {
    return '--model';
  }
}
