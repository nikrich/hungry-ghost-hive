// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import { getEnvFilePath, loadEnvIntoProcess, readEnvFile } from '../../auth/env-store.js';
import { runGitHubDeviceFlow } from '../../auth/github-oauth.js';
import { startJiraOAuthFlow, storeJiraTokens } from '../../auth/jira-oauth.js';
import { authRegistry } from '../../auth/registry.js';
import { TokenStore } from '../../auth/token-store.js';
import { loadConfig } from '../../config/loader.js';
import { openBrowser } from '../../utils/open-browser.js';
import { withHiveRoot } from '../../utils/with-hive-context.js';

export const authCommand = new Command('auth')
  .description('Manage OAuth authentication')
  .option('--provider <name>', 'Authenticate a specific provider')
  .action(async (options: { provider?: string }) => {
    try {
      const { paths } = withHiveRoot(ctx => ctx);

      // If --provider flag is specified, authenticate that provider only
      if (options.provider) {
        const connector = authRegistry.get(options.provider);
        if (!connector) {
          console.error(chalk.red(`Error: Unknown provider "${options.provider}"`));
          console.error(
            chalk.gray(`Available providers: ${authRegistry.getProviderNames().join(', ')}`)
          );
          process.exit(1);
        }

        const result = await connector.run(paths.hiveDir);
        if (!result.success) {
          console.error(chalk.red(`${connector.name} authentication failed:`));
          console.error(chalk.gray(result.message || 'Unknown error'));
          process.exit(1);
        }
        return;
      }

      // No --provider flag: authenticate all configured providers
      const config = loadConfig(paths.hiveDir);
      const providersToAuth: string[] = [];

      // Check source control provider
      if (config.integrations.source_control.provider) {
        providersToAuth.push(config.integrations.source_control.provider);
      }

      // Check project management provider
      if (config.integrations.project_management.provider !== 'none') {
        providersToAuth.push(config.integrations.project_management.provider);
      }

      if (providersToAuth.length === 0) {
        console.log(chalk.yellow('No providers configured. Nothing to authenticate.'));
        console.log(chalk.gray('Run "hive config" to configure integrations.'));
        return;
      }

      console.log(
        chalk.bold(`Authenticating ${providersToAuth.length} configured provider(s)...\n`)
      );

      const results: Array<{ provider: string; success: boolean; message?: string }> = [];

      for (const providerName of providersToAuth) {
        const connector = authRegistry.get(providerName);
        if (!connector) {
          console.error(
            chalk.yellow(`Warning: No auth connector found for "${providerName}". Skipping.`)
          );
          results.push({
            provider: providerName,
            success: false,
            message: 'No auth connector found',
          });
          continue;
        }

        const result = await connector.run(paths.hiveDir);
        results.push(result);

        if (!result.success) {
          console.error(chalk.red(`${connector.name} authentication failed:`));
          console.error(chalk.gray(result.message || 'Unknown error'));
        }

        console.log(); // Add spacing between providers
      }

      // Summary
      console.log(chalk.bold('Authentication Summary:'));
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      for (const result of results) {
        const icon = result.success ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${icon} ${result.provider}: ${result.success ? 'success' : 'failed'}`);
      }

      if (failCount > 0) {
        console.log();
        console.log(chalk.red(`${failCount} provider(s) failed to authenticate.`));
        process.exit(1);
      }

      console.log();
      console.log(chalk.green(`All ${successCount} provider(s) authenticated successfully!`));
    } catch (err) {
      console.error(chalk.red('Authentication failed:'));
      if (err instanceof Error) {
        console.error(chalk.gray(err.message));
      } else {
        console.error(chalk.gray(String(err)));
      }
      process.exit(1);
    }
  });

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
