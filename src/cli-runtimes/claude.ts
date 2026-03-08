// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { CliRuntimeBuilder, RuntimeOptions, RuntimeSafetyMode } from './types.js';

export class ClaudeRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(
    model: string,
    safetyMode: RuntimeSafetyMode,
    options?: RuntimeOptions
  ): string[] {
    const args =
      safetyMode === 'safe'
        ? ['claude', '--model', model]
        : ['claude', '--dangerously-skip-permissions', '--model', model];
    if (options?.chrome) {
      args.push('--chrome');
    }
    return args;
  }

  buildResumeCommand(
    model: string,
    sessionId: string,
    safetyMode: RuntimeSafetyMode,
    options?: RuntimeOptions
  ): string[] {
    const args =
      safetyMode === 'safe'
        ? ['claude', '--model', model, '--resume', sessionId]
        : ['claude', '--dangerously-skip-permissions', '--model', model, '--resume', sessionId];
    if (options?.chrome) {
      args.push('--chrome');
    }
    return args;
  }

  getAutoApprovalFlag(safetyMode: RuntimeSafetyMode): string {
    return safetyMode === 'safe' ? '' : '--dangerously-skip-permissions';
  }

  getModelFlag(): string {
    return '--model';
  }
}
