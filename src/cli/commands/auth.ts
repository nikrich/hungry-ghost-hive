// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import { getEnvFilePath, loadEnvIntoProcess, readEnvFile } from '../../auth/env-store.js';
import { runGitHubDeviceFlow } from '../../auth/github-oauth.js';
import { startJiraOAuthFlow, storeJiraTokens } from '../../auth/jira-oauth.js';
import { TokenStore } from '../../auth/token-store.js';
import { openBrowser } from '../../utils/open-browser.js';
import { withHiveRoot } from '../../utils/with-hive-context.js';

export const authCommand = new Command('auth').description('Manage OAuth authentication');

// GitHub OAuth subcommand
authCommand
  .command('github')
  .description('Re-run GitHub OAuth Device Flow to update authentication token')
  .action(async () => {
    try {
      const { paths } = withHiveRoot(ctx => ctx);
      const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        console.error(chalk.red('Error: GITHUB_OAUTH_CLIENT_ID environment variable is not set.'));
        console.error(chalk.gray('Please set GITHUB_OAUTH_CLIENT_ID and try again.'));
        process.exit(1);
      }

      console.log(chalk.bold('Starting GitHub OAuth Device Flow...'));
      console.log();

      const result = await runGitHubDeviceFlow({
        clientId,
        rootDir: paths.hiveDir,
      });

      console.log();
      console.log(chalk.green('✓ GitHub authentication successful!'));
      console.log(chalk.gray(`User: ${result.username}`));
      console.log(chalk.gray('Token saved to .env'));
    } catch (err) {
      console.error(chalk.red('GitHub OAuth failed:'));
      if (err instanceof Error) {
        console.error(chalk.gray(err.message));
      } else {
        console.error(chalk.gray(String(err)));
      }
      process.exit(1);
    }
  });

// Jira OAuth subcommand
authCommand
  .command('jira')
  .description('Re-run Jira OAuth 2.0 (3LO) to update authentication tokens')
  .action(async () => {
    try {
      const { root, paths } = withHiveRoot(ctx => ctx);

      // Load stored credentials from .hive/.env, then check env vars, then prompt
      loadEnvIntoProcess(root);
      const storedEnv = readEnvFile(root);

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
      const envPath = getEnvFilePath(paths.hiveDir);
      const tokenStore = new TokenStore(envPath);
      await tokenStore.loadFromEnv(envPath);
      await storeJiraTokens(tokenStore, result);

      // Also persist client credentials so token refresh works in future sessions
      const { writeEnvEntries } = await import('../../auth/env-store.js');
      writeEnvEntries(
        {
          JIRA_CLIENT_ID: clientId,
          JIRA_CLIENT_SECRET: clientSecret,
        },
        root
      );

      console.log();
      console.log(chalk.green('✓ Jira authentication successful!'));
      console.log(chalk.gray(`Cloud ID: ${result.cloudId}`));
      console.log(chalk.gray(`Site URL: ${result.siteUrl}`));
      console.log(chalk.gray('Tokens saved to .env'));
    } catch (err) {
      console.error(chalk.red('Jira OAuth failed:'));
      if (err instanceof Error) {
        console.error(chalk.gray(err.message));
      } else {
        console.error(chalk.gray(String(err)));
      }
      process.exit(1);
    }
  });
