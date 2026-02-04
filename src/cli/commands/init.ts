import { Command } from 'commander';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { getHivePaths, isHiveWorkspace } from '../../utils/paths.js';
import { createDatabase } from '../../db/client.js';
import { createDefaultConfig } from '../../config/loader.js';

export const initCommand = new Command('init')
  .description('Initialize a new Hive workspace')
  .option('-f, --force', 'Overwrite existing workspace')
  .action(async (options: { force?: boolean }) => {
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
      const db = createDatabase(paths.dbPath);
      db.runMigrations();
      db.close();

      // Create .gitkeep files
      if (!existsSync(join(paths.reposDir, '.gitkeep'))) {
        const fs = await import('fs');
        fs.writeFileSync(join(paths.reposDir, '.gitkeep'), '');
      }

      spinner.succeed(chalk.green('Hive workspace initialized successfully!'));

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
  });
