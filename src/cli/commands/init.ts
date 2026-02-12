// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, mkdirSync } from 'fs';
import ora from 'ora';
import { join } from 'path';
import { createDefaultConfig, loadConfig, saveConfig } from '../../config/loader.js';
import { createDatabase } from '../../db/client.js';
import { getHivePaths, isHiveWorkspace } from '../../utils/paths.js';
import { runInitWizard } from '../wizard/init-wizard.js';

export const initCommand = new Command('init')
  .description('Initialize a new Hive workspace')
  .option('-f, --force', 'Overwrite existing workspace')
  .option('--non-interactive', 'Skip interactive prompts (use defaults or CLI flags)')
  .option('--source-control <provider>', 'Source control provider (github, gitlab, bitbucket)')
  .option('--project-management <tool>', 'Project management tool (none, jira)')
  .option('--autonomy <level>', 'Agent autonomy level (full, partial)')
  .option('--jira-project <key>', 'Jira project key (for non-interactive mode)')
  .action(
    async (options: {
      force?: boolean;
      nonInteractive?: boolean;
      sourceControl?: string;
      projectManagement?: string;
      autonomy?: string;
      jiraProject?: string;
    }) => {
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
        spinner.text = 'Initializing database...';
        const db = await createDatabase(paths.dbPath);
        db.runMigrations();
        db.close();

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
          jiraProject: options.jiraProject,
        });

        // Update config with wizard selections
        const config = loadConfig(paths.hiveDir);
        config.integrations = wizardResult.integrations;
        saveConfig(paths.hiveDir, config);

        console.log();
        console.log(chalk.bold('Next steps:'));
        console.log(chalk.gray('  1. Add a repository:'));
        console.log(chalk.cyan('     hive add-repo --url <repo-url> --team <team-name>'));
        console.log(chalk.gray('  2. Submit a requirement:'));
        console.log(chalk.cyan('     hive req "Your requirement here"'));
        console.log(chalk.gray('  3. View dashboard:'));
        console.log(chalk.cyan('     hive dashboard'));
        console.log();
      } catch (err) {
        spinner.fail(chalk.red('Failed to initialize Hive workspace'));
        console.error(err);
        process.exit(1);
      }
    }
  );
