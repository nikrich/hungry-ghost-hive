// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { ConnectorAuthResult } from '../common-types.js';

/**
 * Provider-agnostic interface for authentication flows.
 *
 * Each provider implements its own OAuth or API-key flow behind this interface,
 * allowing the auth CLI command to authenticate against any configured provider
 * without knowing the specifics.
 */
export interface IAuthConnector {
  /** The provider identifier (e.g., "github", "jira") */
  readonly provider: string;

  /**
   * Run the full authentication flow for this provider.
   * This may open a browser, start a local server, or prompt for credentials.
   * @param options - Provider-specific options (e.g., clientId, port)
   */
  authenticate(options?: Record<string, unknown>): Promise<ConnectorAuthResult>;

  /**
   * Validate that existing credentials are still valid.
   * @returns true if stored credentials are valid and can be used for API calls
   */
  validateCredentials(): Promise<boolean>;

  /**
   * Get the human-readable provider name for display purposes.
   * @returns Display name (e.g., "GitHub", "Jira")
   */
  getProviderName(): string;
}
