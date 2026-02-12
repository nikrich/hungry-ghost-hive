// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { join } from 'path';
import { startJiraOAuthFlow, storeJiraTokens } from '../../auth/jira-oauth.js';
import { TokenStore } from '../../auth/token-store.js';
import type { IntegrationsConfig } from '../../config/schema.js';
import { openBrowser } from '../../utils/open-browser.js';
import { getHivePaths } from '../../utils/paths.js';
import { runJiraSetup } from './jira-setup.js';

export interface InitWizardOptions {
  nonInteractive?: boolean;
  sourceControl?: string;
  projectManagement?: string;
  autonomy?: string;
  jiraProject?: string;
}

export interface InitWizardResult {
  integrations: IntegrationsConfig;
}

export async function runInitWizard(options: InitWizardOptions = {}): Promise<InitWizardResult> {
  if (options.nonInteractive) {
    return runNonInteractive(options);
  }

  console.log();
  console.log(chalk.bold('Configure your Hive workspace:'));
  console.log();

  // Step 1: Source control provider
  const sourceControl = await select({
    message: 'Source control provider',
    choices: [
      { name: 'GitHub', value: 'github' },
      { name: 'GitLab (coming soon)', value: 'gitlab', disabled: true },
      { name: 'Bitbucket (coming soon)', value: 'bitbucket', disabled: true },
    ],
    default: 'github',
  });

  // Step 2: Project management tool
  const projectManagement = await select({
    message: 'Project management tool',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'Jira', value: 'jira' },
    ],
    default: 'none',
  });

  // Step 3: Autonomy level
  const autonomy = await select({
    message: 'Agent autonomy level',
    choices: [
      {
        name: 'Full — agents work independently, no approval required',
        value: 'full',
      },
      {
        name: 'Partial — agents pause for human approval at key steps',
        value: 'partial',
      },
    ],
    default: 'full',
  });

  console.log();

  return buildResult(
    sourceControl as 'github' | 'bitbucket' | 'gitlab',
    projectManagement as 'none' | 'jira',
    autonomy as 'full' | 'partial',
    options
  );
}

async function runNonInteractive(options: InitWizardOptions): Promise<InitWizardResult> {
  const sourceControl = validateSourceControl(options.sourceControl ?? 'github');
  const projectManagement = validateProjectManagement(options.projectManagement ?? 'none');
  const autonomy = validateAutonomy(options.autonomy ?? 'full');

  return buildResult(sourceControl, projectManagement, autonomy, options);
}

function validateSourceControl(value: string): 'github' | 'bitbucket' | 'gitlab' {
  const valid = ['github', 'bitbucket', 'gitlab'] as const;
  if (!valid.includes(value as (typeof valid)[number])) {
    throw new Error(
      `Invalid source control provider: "${value}". Valid options: ${valid.join(', ')}`
    );
  }
  return value as 'github' | 'bitbucket' | 'gitlab';
}

function validateProjectManagement(value: string): 'none' | 'jira' {
  const valid = ['none', 'jira'] as const;
  if (!valid.includes(value as (typeof valid)[number])) {
    throw new Error(
      `Invalid project management tool: "${value}". Valid options: ${valid.join(', ')}`
    );
  }
  return value as 'none' | 'jira';
}

function validateAutonomy(value: string): 'full' | 'partial' {
  const valid = ['full', 'partial'] as const;
  if (!valid.includes(value as (typeof valid)[number])) {
    throw new Error(`Invalid autonomy level: "${value}". Valid options: ${valid.join(', ')}`);
  }
  return value as 'full' | 'partial';
}

async function buildResult(
  sourceControl: 'github' | 'bitbucket' | 'gitlab',
  projectManagement: 'none' | 'jira',
  autonomy: 'full' | 'partial',
  options: InitWizardOptions = {}
): Promise<InitWizardResult> {
  const integrations: IntegrationsConfig = {
    source_control: { provider: sourceControl },
    project_management: { provider: projectManagement },
    autonomy: { level: autonomy },
  };

  // If Jira is selected, run OAuth and setup wizard
  if (projectManagement === 'jira') {
    console.log();
    console.log(chalk.bold('Jira OAuth Setup'));
    console.log();
    console.log(
      chalk.gray('To connect to Jira, you need to create an OAuth 2.0 (3LO) app in Atlassian:')
    );
    console.log(chalk.gray('  1. Go to https://developer.atlassian.com/console/myapps/'));
    console.log(chalk.gray('  2. Create a new app with OAuth 2.0 (3LO)'));
    console.log(chalk.gray('  3. Add callback URL: http://localhost:9876/callback'));
    console.log(chalk.gray('  4. Enable scopes: read:jira-work, write:jira-work, offline_access'));
    console.log();

    // Get OAuth credentials from environment or prompt user
    const clientId =
      process.env.JIRA_OAUTH_CLIENT_ID ||
      (await input({
        message: 'Jira OAuth Client ID',
        validate: (value: string) => (value.length > 0 ? true : 'Client ID is required'),
      }));

    const clientSecret =
      process.env.JIRA_OAUTH_CLIENT_SECRET ||
      (await input({
        message: 'Jira OAuth Client Secret',
        validate: (value: string) => (value.length > 0 ? true : 'Client Secret is required'),
      }));

    console.log();
    console.log(chalk.gray('Starting OAuth flow...'));

    // Run OAuth flow
    try {
      const oauthResult = await startJiraOAuthFlow({
        clientId,
        clientSecret,
        openBrowser,
      });

      // Store tokens in .env
      const paths = getHivePaths(process.cwd());
      const envPath = join(paths.hiveDir, '.env');
      const tokenStore = new TokenStore(envPath);
      await storeJiraTokens(tokenStore, oauthResult);

      console.log(chalk.green('OAuth successful!'));

      // Run Jira setup wizard
      const setupResult = await runJiraSetup({
        cloudId: oauthResult.cloudId,
        siteUrl: oauthResult.siteUrl,
        accessToken: oauthResult.accessToken,
        nonInteractive: options.nonInteractive,
        jiraProject: options.jiraProject,
      });

      // Add Jira config to integrations
      integrations.project_management.jira = setupResult.jiraConfig;
    } catch (err) {
      console.error(chalk.red('Jira setup failed:'), err);
      console.log(chalk.yellow('Skipping Jira integration. You can set it up later.'));
      integrations.project_management.provider = 'none';
    }
  }

  return { integrations };
}
