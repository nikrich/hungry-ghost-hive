// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Common result type for authentication flows
 */
export interface AuthResult {
  provider: string;
  success: boolean;
  message?: string;
}

/**
 * Interface for authentication connectors
 * Each provider (GitHub, Jira, etc.) implements this interface
 */
export interface IAuthConnector {
  /**
   * The provider name (e.g., "github", "jira")
   */
  readonly name: string;

  /**
   * Run the authentication flow for this provider
   * @param rootDir - The hive root directory for storing credentials
   * @returns Promise resolving to the auth result
   */
  run(rootDir: string): Promise<AuthResult>;
}
