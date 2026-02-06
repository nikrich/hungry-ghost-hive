/**
 * Interface for different CLI runtime builders
 * Generates shell commands to spawn agents using different CLI tools
 */
export interface CliRuntimeBuilder {
  /**
   * Build a command to spawn a new agent
   * @param model The model name to pass to the CLI
   * @param options Additional options for the spawn command
   * @returns The complete shell command string
   */
  buildSpawnCommand(model: string, options?: SpawnOptions): string;

  /**
   * Build a command to resume an existing agent session
   * @param sessionId The tmux session ID to resume
   * @returns The complete shell command string
   */
  buildResumeCommand(sessionId: string): string;

  /**
   * Get the auto-approval flag for this CLI
   * @returns The auto-approval flag string, or empty if not supported
   */
  getAutoApprovalFlag(): string;

  /**
   * Get the model selection flag format
   * @param model The model name
   * @returns The formatted model flag
   */
  getModelFlag(model: string): string;
}

/**
 * Options for building spawn commands
 */
export interface SpawnOptions {
  /** Whether to enable auto-approval mode */
  autoApprove?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/**
 * Supported CLI runtime types
 */
export type CliRuntimeType = 'claude' | 'codex' | 'gemini';
