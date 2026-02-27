// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { startJiraOAuthFlow, storeJiraTokens } from '../../auth/jira-oauth.js';
import { TokenStore } from '../../auth/token-store.js';
import type { E2ETestsConfig, IntegrationsConfig, PersonaConfig } from '../../config/schema.js';
import { bootstrapConnectors } from '../../connectors/bootstrap.js';
import { registry } from '../../connectors/registry.js';
import { openBrowser } from '../../utils/open-browser.js';
import { getHivePaths } from '../../utils/paths.js';
import { runJiraSetup } from './jira-setup.js';

export interface InitWizardOptions {
  nonInteractive?: boolean;
  sourceControl?: string;
  projectManagement?: string;
  autonomy?: string;
  jiraProject?: string;
  e2eTestPath?: string;
}

export interface InitWizardResult {
  integrations: IntegrationsConfig;
  e2e_tests?: E2ETestsConfig;
  personas?: Record<string, PersonaConfig[]>;
}

export async function runInitWizard(options: InitWizardOptions = {}): Promise<InitWizardResult> {
  if (options.nonInteractive) {
    return runNonInteractive(options);
  }

  // Bootstrap connectors to ensure they're registered
  bootstrapConnectors();

  console.log();
  console.log(chalk.bold('Configure your Hive workspace:'));
  console.log();

  // Step 1: Source control provider
  const sourceControlProviders = registry.listSourceControlProviders();
  const sourceControlChoices = sourceControlProviders.map(provider => {
    // Capitalize first letter for display
    const name = provider.charAt(0).toUpperCase() + provider.slice(1);
    return { name, value: provider };
  });

  const sourceControl = await select({
    message: 'Source control provider',
    choices: sourceControlChoices,
    default: sourceControlChoices.length > 0 ? sourceControlChoices[0].value : undefined,
  });

  // Step 2: Project management tool
  const pmProviders = registry.listProjectManagementProviders();
  const pmChoices = [
    { name: 'None', value: 'none' },
    ...pmProviders.map(provider => {
      // Capitalize first letter for display
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      return { name, value: provider };
    }),
  ];

  const projectManagement = await select({
    message: 'Project management tool',
    choices: pmChoices,
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

  // Step 4: Agent personas (optional)
  const agentTypes: { key: string; label: string }[] = [
    { key: 'tech_lead', label: 'Tech Lead' },
    { key: 'senior', label: 'Senior Developer' },
    { key: 'intermediate', label: 'Intermediate Developer' },
    { key: 'junior', label: 'Junior Developer' },
    { key: 'qa', label: 'QA Engineer' },
    { key: 'feature_test', label: 'Feature Test Agent' },
  ];

  let personas: Record<string, PersonaConfig[]> | undefined;

  const wantsPersonas = await confirm({
    message: 'Configure agent personas?',
    default: false,
  });

  if (wantsPersonas) {
    personas = {};
    for (const { key, label } of agentTypes) {
      const countStr = await input({
        message: `How many personas for ${label}? (0 to skip)`,
        default: '0',
        validate: (value: string) => {
          const n = parseInt(value, 10);
          if (isNaN(n) || n < 0 || !Number.isInteger(n)) {
            return 'Enter a non-negative integer';
          }
          return true;
        },
      });

      const count = parseInt(countStr, 10);
      if (count > 0) {
        const agentPersonas: PersonaConfig[] = [];
        for (let i = 1; i <= count; i++) {
          const name = await input({
            message: `Name for ${label} persona #${i}`,
            validate: (value: string) => (value.length > 0 ? true : 'Name is required'),
          });
          const persona = await input({
            message: `Personality description for ${name}`,
            validate: (value: string) => (value.length > 0 ? true : 'Description is required'),
          });
          agentPersonas.push({ name, persona });
        }
        personas[key] = agentPersonas;
      }
    }

    // Only keep personas if at least one agent type has entries
    if (Object.keys(personas).length === 0) {
      personas = undefined;
    }
  }

  // Step 5: E2E testing configuration (optional)
  const wantsE2E = await confirm({
    message: 'Configure E2E testing?',
    default: false,
  });

  let e2eTestPath: string | undefined;
  if (wantsE2E) {
    e2eTestPath = await input({
      message: 'Path to E2E tests directory',
      default: './e2e',
      validate: (value: string) => (value.length > 0 ? true : 'Path is required'),
    });

    const resolvedPath = resolve(e2eTestPath);
    if (!existsSync(resolvedPath)) {
      console.log(chalk.yellow(`  Warning: Directory "${e2eTestPath}" does not exist yet.`));
    } else {
      const testingMdPath = join(resolvedPath, 'TESTING.md');
      if (!existsSync(testingMdPath)) {
        console.log(
          chalk.yellow(
            `  Warning: TESTING.md not found at "${testingMdPath}". ` +
              'This file is needed to instruct AI agents on running E2E tests.'
          )
        );
      }
    }
  }

  console.log();

  return buildResult(
    sourceControl as 'github' | 'bitbucket' | 'gitlab',
    projectManagement as 'none' | 'jira',
    autonomy as 'full' | 'partial',
    options,
    e2eTestPath,
    personas
  );
}

async function runNonInteractive(options: InitWizardOptions): Promise<InitWizardResult> {
  const sourceControl = validateSourceControl(options.sourceControl ?? 'github');
  const projectManagement = validateProjectManagement(options.projectManagement ?? 'none');
  const autonomy = validateAutonomy(options.autonomy ?? 'full');

  let e2eTestPath: string | undefined;
  if (options.e2eTestPath) {
    const resolvedPath = resolve(options.e2eTestPath);
    if (!existsSync(resolvedPath)) {
      console.log(
        chalk.yellow(`  Warning: E2E test directory "${options.e2eTestPath}" does not exist yet.`)
      );
    } else {
      const testingMdPath = join(resolvedPath, 'TESTING.md');
      if (!existsSync(testingMdPath)) {
        console.log(
          chalk.yellow(
            `  Warning: TESTING.md not found at "${testingMdPath}". ` +
              'This file is needed to instruct AI agents on running E2E tests.'
          )
        );
      }
    }
    e2eTestPath = options.e2eTestPath;
  }

  return buildResult(sourceControl, projectManagement, autonomy, options, e2eTestPath);
}

function validateSourceControl(value: string): string {
  // Bootstrap connectors to ensure they're registered
  bootstrapConnectors();

  const valid = registry.listSourceControlProviders();
  if (!valid.includes(value)) {
    throw new Error(
      `Invalid source control provider: "${value}". Valid options: ${valid.join(', ')}`
    );
  }
  return value;
}

function validateProjectManagement(value: string): string {
  // Bootstrap connectors to ensure they're registered
  bootstrapConnectors();

  const valid = ['none', ...registry.listProjectManagementProviders()];
  if (!valid.includes(value)) {
    throw new Error(
      `Invalid project management tool: "${value}". Valid options: ${valid.join(', ')}`
    );
  }
  return value;
}

function validateAutonomy(value: string): 'full' | 'partial' {
  const valid = ['full', 'partial'] as const;
  if (!valid.includes(value as (typeof valid)[number])) {
    throw new Error(`Invalid autonomy level: "${value}". Valid options: ${valid.join(', ')}`);
  }
  return value as 'full' | 'partial';
}

async function buildResult(
  sourceControl: string,
  projectManagement: string,
  autonomy: 'full' | 'partial',
  options: InitWizardOptions = {},
  e2eTestPath?: string,
  personas?: Record<string, PersonaConfig[]>
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
    console.log(chalk.gray('  3. Add callback URL: http://127.0.0.1:9876/callback'));
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

      // Store tokens and client credentials in .env
      const paths = getHivePaths(process.cwd());
      const envPath = join(paths.hiveDir, '.env');
      const tokenStore = new TokenStore(envPath);
      await storeJiraTokens(tokenStore, oauthResult);

      const { writeEnvEntries } = await import('../../auth/env-store.js');
      writeEnvEntries(
        {
          JIRA_CLIENT_ID: clientId,
          JIRA_CLIENT_SECRET: clientSecret,
        },
        process.cwd()
      );

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

  const result: InitWizardResult = { integrations };
  if (e2eTestPath) {
    result.e2e_tests = { path: e2eTestPath };
  }
  if (personas) {
    result.personas = personas;
  }
  return result;
}
