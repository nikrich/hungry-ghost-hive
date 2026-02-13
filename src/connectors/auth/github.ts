// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { ConnectorAuthResult } from '../common-types.js';
import { registry } from '../registry.js';
import type { IAuthConnector } from './types.js';

/**
 * GitHub implementation of IAuthConnector.
 *
 * Thin adapter that delegates to the existing GitHub Device Flow
 * implementation in `src/auth/github-oauth.ts`.
 */
export class GitHubAuthConnector implements IAuthConnector {
  readonly provider = 'github';

  async authenticate(options?: Record<string, unknown>): Promise<ConnectorAuthResult> {
    const { runGitHubDeviceFlow } = await import('../../auth/github-oauth.js');

    const clientId = (options?.clientId as string) || process.env.GITHUB_CLIENT_ID || '';
    const rootDir = (options?.rootDir as string) || undefined;

    if (!clientId) {
      return {
        success: false,
        provider: this.provider,
        message: 'GitHub Client ID is required. Set GITHUB_CLIENT_ID or pass clientId in options.',
      };
    }

    try {
      const result = await runGitHubDeviceFlow({ clientId, rootDir });
      return {
        success: true,
        provider: this.provider,
        message: `Authenticated as ${result.username}`,
      };
    } catch (err) {
      return {
        success: false,
        provider: this.provider,
        message: `GitHub auth failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async validateCredentials(): Promise<boolean> {
    const { isGitHubAuthenticated } = await import('../../git/github.js');
    const status = await isGitHubAuthenticated();
    return status.authenticated;
  }

  getProviderName(): string {
    return 'GitHub';
  }
}

/**
 * Register the GitHub auth connector with the global registry.
 * Call this once at startup to make the connector available via
 * `registry.getAuth('github')`.
 */
export function register(): void {
  registry.registerAuth('github', () => new GitHubAuthConnector());
}
