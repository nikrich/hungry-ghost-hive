// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IAuthConnector } from './connector.js';
import { GitHubAuthConnector } from './connectors/github.js';
import { JiraAuthConnector } from './connectors/jira.js';

/**
 * Registry of authentication connectors
 */
class AuthConnectorRegistry {
  private connectors = new Map<string, IAuthConnector>();

  constructor() {
    // Register built-in connectors
    this.register(new GitHubAuthConnector());
    this.register(new JiraAuthConnector());
  }

  /**
   * Register an auth connector
   */
  register(connector: IAuthConnector): void {
    this.connectors.set(connector.name, connector);
  }

  /**
   * Get an auth connector by provider name
   */
  get(providerName: string): IAuthConnector | undefined {
    return this.connectors.get(providerName);
  }

  /**
   * Get all registered connector names
   */
  getProviderNames(): string[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Check if a provider is registered
   */
  has(providerName: string): boolean {
    return this.connectors.has(providerName);
  }
}

// Singleton instance
export const authRegistry = new AuthConnectorRegistry();
