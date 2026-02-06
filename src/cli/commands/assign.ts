import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { startManager, isManagerRunning } from '../../tmux/manager.js';

export const assignCommand = new Command('assign')
  .description('Assign planned stories to agents (spawns Seniors as needed)')
  .option('--dry-run', 'Show what would be assigned without making changes')
  .action(async (options: { dryRun?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    const spinner = ora('Assigning stories...').start();

    try {
      const config = loadConfig(paths.hiveDir);

      if (options.dryRun) {
        spinner.info(chalk.yellow('Dry run - no changes will be made'));
        // TODO: Add dry run logic
        return;
      }

      const scheduler = new Scheduler(db.db, {
        scaling: config.scaling,
        models: config.models,
        rootDir: root,
      });

      // Check scaling first (spawns additional seniors if needed)
      spinner.text = 'Checking team scaling...';
      await scheduler.checkScaling();

      // Check merge queue (spawns QA agents if needed)
      spinner.text = 'Checking merge queue...';
      await scheduler.checkMergeQueue();

      // Assign stories to agents
      spinner.text = 'Assigning stories to agents...';
      const result = await scheduler.assignStories();

      let summaryMsg = `Assigned ${result.assigned} stories`;
      if (result.preventedDuplicates > 0) {
        summaryMsg += ` (prevented ${result.preventedDuplicates} duplicate assignments)`;
      }

      if (result.errors.length > 0) {
        spinner.warn(chalk.yellow(`${summaryMsg} with ${result.errors.length} errors`));
        for (const error of result.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
      } else if (result.assigned === 0) {
        if (result.preventedDuplicates > 0) {
          spinner.info(chalk.yellow(summaryMsg));
        } else {
          spinner.info(chalk.gray('No stories to assign'));
        }
      } else {
        spinner.succeed(chalk.green(summaryMsg));
      }

      // Auto-start the manager if work was assigned and it's not running
      if (result.assigned > 0) {
        if (!await isManagerRunning()) {
          spinner.start('Starting manager daemon...');
          const started = await startManager(60);
          if (started) {
            spinner.succeed(chalk.green('Manager daemon started (checking every 60s)'));
          } else {
            spinner.info(chalk.gray('Manager daemon already running'));
          }
        }
      }

      console.log();
      console.log(chalk.gray('View agent status:'));
      console.log(chalk.cyan('  hive agents list --active'));
      console.log();
    } catch (err) {
      spinner.fail(chalk.red('Failed to assign stories'));
      console.error(err);
      process.exit(1);
    } finally {
      db.close();
    }
  });
