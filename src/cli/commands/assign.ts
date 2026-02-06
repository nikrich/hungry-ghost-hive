import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { startManager, isManagerRunning } from '../../tmux/manager.js';
import { getPlannedStories } from '../../db/queries/stories.js';
import { getTeamById } from '../../db/queries/teams.js';

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
        spinner.stop();
        performDryRun(db.db, config);
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

      if (result.errors.length > 0) {
        spinner.warn(chalk.yellow(`Assigned ${result.assigned} stories with ${result.errors.length} errors`));
        for (const error of result.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
      } else if (result.assigned === 0) {
        spinner.info(chalk.gray('No stories to assign'));
      } else {
        spinner.succeed(chalk.green(`Assigned ${result.assigned} stories`));
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

function performDryRun(db: any, config: any): void {
  const plannedStories = getPlannedStories(db);

  if (plannedStories.length === 0) {
    console.log(chalk.gray('No stories to assign'));
    return;
  }

  console.log(chalk.cyan('Assignment Plan (dry run):'));
  console.log();

  const assignments: { storyId: string; title: string; agentType: string; team: string }[] = [];

  for (const story of plannedStories) {
    const team = story.team_id ? getTeamById(db, story.team_id) : null;
    const teamName = team?.name || 'Unknown';

    const complexity = story.complexity_score || 5;
    let agentType: string;

    if (complexity <= config.scaling.junior_max_complexity) {
      agentType = 'Junior';
    } else if (complexity <= config.scaling.intermediate_max_complexity) {
      agentType = 'Intermediate';
    } else {
      agentType = 'Senior';
    }

    assignments.push({
      storyId: story.id,
      title: story.title,
      agentType,
      team: teamName,
    });
  }

  // Display table header
  const storyIdWidth = 20;
  const titleWidth = 50;
  const agentTypeWidth = 15;
  const teamWidth = 15;

  console.log(
    chalk.bold(
      `${'Story ID'.padEnd(storyIdWidth)} | ${'Title'.padEnd(titleWidth)} | ${'Agent Type'.padEnd(agentTypeWidth)} | ${'Team'.padEnd(teamWidth)}`
    )
  );
  console.log('-'.repeat(storyIdWidth + titleWidth + agentTypeWidth + teamWidth + 9));

  // Display assignments
  for (const assignment of assignments) {
    const truncatedTitle = assignment.title.length > titleWidth ? assignment.title.substring(0, titleWidth - 3) + '...' : assignment.title;
    console.log(
      `${assignment.storyId.padEnd(storyIdWidth)} | ${truncatedTitle.padEnd(titleWidth)} | ${assignment.agentType.padEnd(agentTypeWidth)} | ${assignment.team.padEnd(teamWidth)}`
    );
  }

  console.log();
  console.log(chalk.yellow(`Would assign ${assignments.length} stories (no changes made)`));
}
