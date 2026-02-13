// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import type { AuthResult, IAuthConnector } from '../connector.js';
import { getEnvFilePath, loadEnvIntoProcess, readEnvFile, writeEnvEntries } from '../env-store.js';
import { startJiraOAuthFlow, storeJiraTokens } from '../jira-oauth.js';
import { TokenStore } from '../token-store.js';
import { openBrowser } from '../../utils/open-browser.js';

/**
 * Jira authentication connector
 */
export class JiraAuthConnector implements IAuthConnector {
  readonly name = 'jira';

  async run(rootDir: string): Promise<AuthResult> {
    try {
      // Load stored credentials from .hive/.env, then check env vars, then prompt
      loadEnvIntoProcess(rootDir);
      const storedEnv = readEnvFile(rootDir);

      const clientId =
        process.env.JIRA_OAUTH_CLIENT_ID ||
        storedEnv.JIRA_CLIENT_ID ||
        (await input({
          message: 'Jira OAuth Client ID',
          validate: (v: string) => (v.length > 0 ? true : 'Client ID is required'),
        }));

      const clientSecret =
        process.env.JIRA_OAUTH_CLIENT_SECRET ||
        storedEnv.JIRA_CLIENT_SECRET ||
        (await input({
          message: 'Jira OAuth Client Secret',
          validate: (v: string) => (v.length > 0 ? true : 'Client Secret is required'),
        }));

      console.log(chalk.bold('Starting Jira OAuth 2.0 (3LO) Flow...'));
      console.log();

      const result = await startJiraOAuthFlow({
        clientId,
        clientSecret,
        openBrowser,
      });

      // Store tokens using TokenStore
      const envPath = getEnvFilePath(rootDir);
      const tokenStore = new TokenStore(envPath);
      await tokenStore.loadFromEnv(envPath);
      await storeJiraTokens(tokenStore, result);

      // Also persist client credentials so token refresh works in future sessions
      writeEnvEntries(
        {
          JIRA_CLIENT_ID: clientId,
          JIRA_CLIENT_SECRET: clientSecret,
        },
        rootDir
      );

      console.log();
      console.log(chalk.green('✓ Jira authentication successful!'));
      console.log(chalk.gray(`Cloud ID: ${result.cloudId}`));
      console.log(chalk.gray(`Site URL: ${result.siteUrl}`));
      console.log(chalk.gray('Tokens saved to .env'));

      return {
        provider: this.name,
        success: true,
        message: `Authenticated with ${result.siteUrl}`,
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
