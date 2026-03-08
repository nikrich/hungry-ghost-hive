// Licensed under the Hungry Ghost Hive License. See LICENSE.

export type CliRuntimeType = 'claude' | 'codex' | 'gemini';
export type RuntimeSafetyMode = 'safe' | 'unsafe';

export interface RuntimeOptions {
  chrome?: boolean;
}

export interface CliRuntimeBuilder {
  /**
   * Build command array for spawning a new agent session
   * @param model - The model identifier to use
   * @param safetyMode - The safety mode for the agent
   * @param options - Optional runtime options (e.g., chrome flag)
   * @returns Array of command and arguments suitable for spawn
   */
  buildSpawnCommand(
    model: string,
    safetyMode: RuntimeSafetyMode,
    options?: RuntimeOptions
  ): string[];

  /**
   * Build command array for resuming an existing agent session
   * @param model - The model identifier to use
   * @param sessionId - The session ID to resume
   * @param safetyMode - The safety mode for the agent
   * @param options - Optional runtime options (e.g., chrome flag)
   * @returns Array of command and arguments suitable for spawn
   */
  buildResumeCommand(
    model: string,
    sessionId: string,
    safetyMode: RuntimeSafetyMode,
    options?: RuntimeOptions
  ): string[];

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
