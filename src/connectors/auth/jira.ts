// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { ConnectorAuthResult } from '../common-types.js';
import { registry } from '../registry.js';
import type { IAuthConnector } from './types.js';

/**
 * Jira implementation of IAuthConnector.
 *
 * Thin adapter that delegates to the existing Jira OAuth 2.0 (3LO) flow
 * in `src/auth/jira-oauth.ts`.
 */
export class JiraAuthConnector implements IAuthConnector {
  readonly provider = 'jira';

  async authenticate(options?: Record<string, unknown>): Promise<ConnectorAuthResult> {
    const { startJiraOAuthFlow, storeJiraTokens } = await import('../../auth/jira-oauth.js');
    const { TokenStore } = await import('../../auth/token-store.js');

    const clientId = (options?.clientId as string) || process.env.JIRA_CLIENT_ID || '';
    const clientSecret = (options?.clientSecret as string) || process.env.JIRA_CLIENT_SECRET || '';
    const openBrowser = options?.openBrowser as ((url: string) => Promise<void>) | undefined;

    if (!clientId || !clientSecret) {
      return {
        success: false,
        provider: this.provider,
        message:
          'Jira Client ID and Client Secret are required. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET or pass them in options.',
      };
    }

    try {
      const result = await startJiraOAuthFlow({ clientId, clientSecret, openBrowser });

      // Store tokens if rootDir provided
      const rootDir = options?.rootDir as string | undefined;
      if (rootDir) {
        const { join } = await import('path');
        const envPath = join(rootDir, '.hive', '.env');
        const tokenStore = new TokenStore(envPath);
        await storeJiraTokens(tokenStore, result);
      }

      return {
        success: true,
        provider: this.provider,
        message: `Authenticated with Jira site (cloud ID: ${result.cloudId})`,
      };
    } catch (err) {
      return {
        success: false,
        provider: this.provider,
        message: `Jira auth failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async validateCredentials(): Promise<boolean> {
    // Check if Jira tokens are present in environment
    const accessToken = process.env.JIRA_ACCESS_TOKEN;
    const cloudId = process.env.JIRA_CLOUD_ID;
    return !!(accessToken && cloudId);
  }

  getProviderName(): string {
    return 'Jira';
  }
}

/**
 * Register the Jira auth connector with the global registry.
 * Call this once at startup to make the connector available via
 * `registry.getAuth('jira')`.
 */
export function register(): void {
  registry.registerAuth('jira', () => new JiraAuthConnector());
}
