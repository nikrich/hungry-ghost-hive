// Licensed under the Hungry Ghost Hive License. See LICENSE.

export type CliRuntimeType = 'claude' | 'codex' | 'gemini';
export type RuntimeSafetyMode = 'safe' | 'unsafe';

export interface CliRuntimeBuilder {
  /**
   * Build command array for spawning a new agent session
   * @param model - The model identifier to use
   * @returns Array of command and arguments suitable for spawn
   */
  buildSpawnCommand(model: string, safetyMode: RuntimeSafetyMode): string[];

  /**
   * Build command array for resuming an existing agent session
   * @param model - The model identifier to use
   * @param sessionId - The session ID to resume
   * @returns Array of command and arguments suitable for spawn
   */
  buildResumeCommand(model: string, sessionId: string, safetyMode: RuntimeSafetyMode): string[];

  /**
   * Get the auto-approval flag for this CLI runtime
   * @returns The flag string that enables auto-approval mode
   */
  getAutoApprovalFlag(safetyMode: RuntimeSafetyMode): string;

  /**
   * Get the model flag for this CLI runtime
   * @returns The flag string used to specify the model
   */
  getModelFlag(): string;
}
