// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { IntegrationsConfig } from '../../config/schema.js';

export interface InitWizardOptions {
  nonInteractive?: boolean;
  sourceControl?: string;
  projectManagement?: string;
  autonomy?: string;
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
  );
}

function runNonInteractive(options: InitWizardOptions): InitWizardResult {
  const sourceControl = validateSourceControl(options.sourceControl ?? 'github');
  const projectManagement = validateProjectManagement(options.projectManagement ?? 'none');
  const autonomy = validateAutonomy(options.autonomy ?? 'full');

  return buildResult(sourceControl, projectManagement, autonomy);
}

function validateSourceControl(value: string): 'github' | 'bitbucket' | 'gitlab' {
  const valid = ['github', 'bitbucket', 'gitlab'] as const;
  if (!valid.includes(value as (typeof valid)[number])) {
    throw new Error(
      `Invalid source control provider: "${value}". Valid options: ${valid.join(', ')}`,
    );
  }
  return value as 'github' | 'bitbucket' | 'gitlab';
}

function validateProjectManagement(value: string): 'none' | 'jira' {
  const valid = ['none', 'jira'] as const;
  if (!valid.includes(value as (typeof valid)[number])) {
    throw new Error(
      `Invalid project management tool: "${value}". Valid options: ${valid.join(', ')}`,
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

function buildResult(
  sourceControl: 'github' | 'bitbucket' | 'gitlab',
  projectManagement: 'none' | 'jira',
  autonomy: 'full' | 'partial',
): InitWizardResult {
  return {
    integrations: {
      source_control: { provider: sourceControl },
      project_management: { provider: projectManagement },
      autonomy: { level: autonomy },
    },
  };
}
