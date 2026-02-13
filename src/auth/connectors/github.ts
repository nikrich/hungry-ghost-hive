// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { AuthResult, IAuthConnector } from '../connector.js';
import { runGitHubDeviceFlow } from '../github-oauth.js';

/**
 * GitHub authentication connector
 */
export class GitHubAuthConnector implements IAuthConnector {
  readonly name = 'github';

  async run(rootDir: string): Promise<AuthResult> {
    try {
      const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        return {
          provider: this.name,
          success: false,
          message: 'GITHUB_OAUTH_CLIENT_ID environment variable is not set',
        };
      }

      console.log(chalk.bold('Starting GitHub OAuth Device Flow...'));
      console.log();

      const result = await runGitHubDeviceFlow({
        clientId,
        rootDir,
      });

      console.log();
      console.log(chalk.green('✓ GitHub authentication successful!'));
      console.log(chalk.gray(`User: ${result.username}`));
      console.log(chalk.gray('Token saved to .env'));

      return {
        provider: this.name,
        success: true,
        message: `Authenticated as ${result.username}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider: this.name,
        success: false,
        message,
      };
    }
  }
}
