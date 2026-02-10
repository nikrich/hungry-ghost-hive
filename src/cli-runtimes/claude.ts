// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { CliRuntimeBuilder, RuntimeSafetyMode } from './types.js';

export class ClaudeRuntimeBuilder implements CliRuntimeBuilder {
  buildSpawnCommand(model: string, safetyMode: RuntimeSafetyMode): string[] {
    if (safetyMode === 'safe') {
      return ['claude', '--model', model];
    }
    return ['claude', '--dangerously-skip-permissions', '--model', model];
  }

  buildResumeCommand(model: string, sessionId: string, safetyMode: RuntimeSafetyMode): string[] {
    if (safetyMode === 'safe') {
      return ['claude', '--model', model, '--resume', sessionId];
    }
    return ['claude', '--dangerously-skip-permissions', '--model', model, '--resume', sessionId];
  }

  getAutoApprovalFlag(safetyMode: RuntimeSafetyMode): string {
    return safetyMode === 'safe' ? '' : '--dangerously-skip-permissions';
  }

  getModelFlag(): string {
    return '--model';
  }
}
