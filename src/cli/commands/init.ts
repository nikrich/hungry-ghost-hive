// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { nanoid } from 'nanoid';
import ora from 'ora';
import { join } from 'path';
import { createDefaultConfig, loadConfig, saveConfig } from '../../config/loader.js';
import type { HiveConfig } from '../../config/schema.js';
import { createDatabase } from '../../db/client.js';
import { createPostgresProvider } from '../../db/postgres-provider.js';
import { getHivePaths, isHiveWorkspace } from '../../utils/paths.js';
import type { AgentRuntime } from '../wizard/init-wizard.js';
import { runInitWizard } from '../wizard/init-wizard.js';

export const initCommand = new Command('init')
  .description('Initialize a new Hive workspace')
  .option('-f, --force', 'Overwrite existing workspace')
  .option('--non-interactive', 'Skip interactive prompts (use defaults or CLI flags)')
  .option('--source-control <provider>', 'Source control provider (github, gitlab, bitbucket)')
  .option('--project-management <tool>', 'Project management tool (none, jira)')
  .option('--autonomy <level>', 'Agent autonomy level (full, partial)')
  .option('--agent-runtime <runtime>', 'Agent runtime (claude, codex)')
  .option('--jira-project <key>', 'Jira project key (for non-interactive mode)')
  .option('--e2e-test-path <path>', 'Path to E2E tests directory')
  .option('--distributed', 'Use Postgres for distributed multi-workspace mode')
  .option(
    '--workspace <id>',
    'Use a specific workspace ID (distributed mode only, resumes existing workspace)'
  )
  .action(
    async (options: {
      force?: boolean;
      nonInteractive?: boolean;
      sourceControl?: string;
      projectManagement?: string;
      autonomy?: string;
      agentRuntime?: string;
      jiraProject?: string;
      e2eTestPath?: string;
      distributed?: boolean;
      workspace?: string;
    }) => {
      // --workspace implies --distributed
      if (options.workspace) {
        options.distributed = true;
      }
      const rootDir = process.cwd();
      const paths = getHivePaths(rootDir);

      // Check if already initialized
      if (isHiveWorkspace(rootDir) && !options.force) {
        console.log(chalk.yellow('Hive workspace already exists in this directory.'));
        console.log(chalk.gray('Use --force to reinitialize.'));
        process.exit(1);
      }

      const spinner = ora('Initializing Hive workspace...').start();

      try {
        // Create directory structure
        spinner.text = 'Creating directories...';
        mkdirSync(paths.hiveDir, { recursive: true });
        mkdirSync(paths.agentsDir, { recursive: true });
        mkdirSync(paths.logsDir, { recursive: true });
        mkdirSync(paths.reposDir, { recursive: true });

        // Create default configuration
        spinner.text = 'Creating configuration...';
        createDefaultConfig(paths.hiveDir);

        // Initialize database
        if (options.distributed) {
          spinner.text = 'Validating Postgres connection...';
          await initDistributedDatabase(paths.workspaceIdPath, options.workspace);
        } else {
          spinner.text = 'Initializing database...';
          const db = await createDatabase(paths.dbPath);
          db.runMigrations();
          db.close();
        }

        // Initialize git repository if not already in one
        spinner.text = 'Initializing git repository...';
        try {
          await execa('git', ['rev-parse', '--git-dir'], { cwd: rootDir });
        } catch {
          await execa('git', ['init'], { cwd: rootDir });
        }

        // Create .gitkeep files
        if (!existsSync(join(paths.reposDir, '.gitkeep'))) {
          const fs = await import('fs');
          fs.writeFileSync(join(paths.reposDir, '.gitkeep'), '');
        }

        spinner.succeed(chalk.green('Hive workspace initialized successfully!'));

        // Run interactive wizard to configure integrations
        const wizardResult = await runInitWizard({
          nonInteractive: options.nonInteractive,
          sourceControl: options.sourceControl,
          projectManagement: options.projectManagement,
          autonomy: options.autonomy,
          agentRuntime: options.agentRuntime,
          jiraProject: options.jiraProject,
          e2eTestPath: options.e2eTestPath,
        });

        // Update config with wizard selections
        const config = loadConfig(paths.hiveDir);
        config.integrations = wizardResult.integrations;
        applyAgentRuntimePreset(config, wizardResult.agent_runtime);
        if (wizardResult.e2e_tests) {
          config.e2e_tests = wizardResult.e2e_tests;
        }
        if (wizardResult.personas) {
          for (const [agentType, personas] of Object.entries(wizardResult.personas)) {
            const modelKey = agentType as keyof typeof config.models;
            if (config.models[modelKey]) {
              config.models[modelKey].personas = personas;
            }
          }
        }
        if (options.distributed) {
          config.distributed = true;
        }
        saveConfig(paths.hiveDir, config);

        console.log();
        console.log(chalk.bold('Next steps:'));
        console.log(chalk.gray('  1. Add a repository:'));
        console.log(chalk.cyan('     hive add-repo --url <repo-url> --team <team-name>'));
        console.log(chalk.gray('  2. Submit a requirement:'));
        console.log(chalk.cyan('     hive req "Your requirement here"'));
        console.log(chalk.gray('  3. View dashboard:'));
        console.log(chalk.cyan('     hive dashboard'));
        if (options.distributed) {
          const { readFileSync } = await import('fs');
          const wsId = readFileSync(paths.workspaceIdPath, 'utf-8').trim();
          console.log();
          console.log(chalk.gray('  Distributed mode enabled. Database: Postgres'));
          console.log(chalk.gray(`  Workspace ID: ${wsId}`));
          console.log();
          console.log(chalk.gray('  To resume this workspace from another directory:'));
          console.log(chalk.cyan(`     hive init --workspace ${wsId}`));
        }
        console.log();
      } catch (err) {
        spinner.fail(chalk.red('Failed to initialize Hive workspace'));
        console.error(err);
        process.exit(1);
      }
    }
  );

/**
 * Initialize distributed mode: validate HIVE_DATABASE_URL, test connection,
 * generate or reuse workspace_id, and run Postgres migrations.
 */
async function initDistributedDatabase(
  workspaceIdPath: string,
  existingWorkspaceId?: string
): Promise<void> {
  // Load .env if available
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
  } catch {
    // dotenv not available
  }

  const connectionString = process.env.HIVE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'HIVE_DATABASE_URL environment variable is not set.\n' +
        'Set it in your environment or in a .env file before running hive init --distributed.\n' +
        'Example: HIVE_DATABASE_URL=postgres://user:pass@host:5432/hive'
    );
  }

  // Use provided workspace ID or generate a new one
  const workspaceId = existingWorkspaceId || nanoid();
  writeFileSync(workspaceIdPath, workspaceId, 'utf-8');

  // Test connection and run migrations
  const provider = await createPostgresProvider(workspaceId);
  await provider.close();
}

function applyAgentRuntimePreset(config: HiveConfig, agentRuntime: AgentRuntime): void {
  const provider = agentRuntime === 'codex' ? 'openai' : 'anthropic';
  const cliTool = agentRuntime;

  const advancedModel = agentRuntime === 'codex' ? 'gpt-5.2-codex' : 'claude-opus-4-6';
  const standardModel = agentRuntime === 'codex' ? 'gpt-5.2-codex' : 'claude-sonnet-4-5-20250929';

  const advancedRoles: Array<keyof HiveConfig['models']> = ['tech_lead', 'senior', 'feature_test'];
  const standardRoles: Array<keyof HiveConfig['models']> = ['intermediate', 'junior', 'qa'];

  for (const role of advancedRoles) {
    config.models[role].provider = provider;
    config.models[role].cli_tool = cliTool;
    config.models[role].model = advancedModel;
  }

  for (const role of standardRoles) {
    config.models[role].provider = provider;
    config.models[role].cli_tool = cliTool;
    config.models[role].model = standardModel;
  }
}
