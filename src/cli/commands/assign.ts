// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { fetchLocalClusterStatus } from '../../cluster/runtime.js';
import { loadConfig } from '../../config/loader.js';
import { getRequirementById } from '../../db/queries/requirements.js';
import { getPlannedStories } from '../../db/queries/stories.js';
import { getTeamById } from '../../db/queries/teams.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { isManagerRunning, startManager } from '../../tmux/manager.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const assignCommand = new Command('assign')
  .description('Assign planned stories to agents (spawns Seniors as needed)')
  .option('--dry-run', 'Show what would be assigned without making changes')
  .action(async (options: { dryRun?: boolean }) => {
    // Track if we need to start the manager after DB is closed
    let shouldStartManager = false;

    await withHiveContext(async ({ root, paths, db }) => {
      const spinner = ora('Assigning stories...').start();

      try {
        const config = loadConfig(paths.hiveDir);

        if (config.cluster.enabled) {
          const clusterStatus = await fetchLocalClusterStatus(config.cluster);
          if (!clusterStatus) {
            spinner.fail(
              chalk.red(
                'Cluster mode is enabled, but local cluster runtime is unavailable. Start manager first.'
              )
            );
            process.exit(1);
          }
          if (!clusterStatus.is_leader) {
            spinner.fail(
              chalk.red(
                `Only the cluster leader can assign stories (leader: ${clusterStatus.leader_id || 'unknown'}).`
              )
            );
            process.exit(1);
          }
        }

        // Check if godmode is active
        const plannedStories = getPlannedStories(db.db);
        let godmodeActive = false;
        for (const story of plannedStories) {
          if (story.requirement_id) {
            const requirement = getRequirementById(db.db, story.requirement_id);
            if (requirement && requirement.godmode) {
              godmodeActive = true;
              break;
            }
          }
        }

        if (options.dryRun) {
          spinner.info(chalk.yellow('Dry run - no changes will be made'));

          if (godmodeActive) {
            console.log(chalk.yellow('⚡ GODMODE is active - all agents will use Opus 4.6\n'));
          }

          if (plannedStories.length === 0) {
            spinner.succeed(chalk.gray('No stories to assign'));
            return;
          }

          console.log(chalk.bold('\nStories that would be assigned:\n'));

          // Group by team for better readability
          const storiesByTeam = new Map<string, typeof plannedStories>();
          for (const story of plannedStories) {
            if (!story.team_id) continue;
            const existing = storiesByTeam.get(story.team_id) || [];
            existing.push(story);
            storiesByTeam.set(story.team_id, existing);
          }

          // Display planned assignments
          for (const [teamId, stories] of storiesByTeam) {
            const team = getTeamById(db.db, teamId);
            if (!team) continue;

            console.log(chalk.cyan(`\n📦 Team: ${team.name}\n`));

            for (const story of stories) {
              const complexity = story.complexity_score || 5;
              let targetLevel = 'Senior';

              if (complexity <= config.scaling.junior_max_complexity) {
                targetLevel = 'Junior';
              } else if (complexity <= config.scaling.intermediate_max_complexity) {
                targetLevel = 'Intermediate';
              }

              console.log(`  ${chalk.blue(`[${story.id}]`)} ${story.title}`);
              console.log(`    Complexity: ${complexity} → ${targetLevel}`);
              console.log();
            }
          }

          console.log(chalk.green(`✓ Would assign ${plannedStories.length} stories\n`));
          return;
        }

        if (godmodeActive) {
          console.log(chalk.yellow('⚡ GODMODE is active - all agents will use Opus 4.6\n'));
        }

        const scheduler = new Scheduler(db.db, {
          scaling: config.scaling,
          models: config.models,
          qa: config.qa,
          rootDir: root,
          saveFn: () => db.save(),
          hiveConfig: config,
        });

        // Check scaling first (spawns additional seniors if needed)
        spinner.text = 'Checking team scaling...';
        await scheduler.checkScaling();
        db.save(); // Save immediately to prevent race condition with manager daemon

        // Check merge queue (spawns QA agents if needed)
        spinner.text = 'Checking merge queue...';
        await scheduler.checkMergeQueue();
        db.save(); // Save immediately to prevent race condition with manager daemon

        // Assign stories to agents
        spinner.text = 'Assigning stories to agents...';
        const result = await scheduler.assignStories();
        db.save(); // Save immediately to prevent race condition with manager daemon

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

        // Determine if we should start the manager, but don't start it yet
        // Wait until after withHiveContext closes the DB to prevent race condition
        if (result.assigned > 0) {
          shouldStartManager = !(await isManagerRunning());
        }

        console.log();
        console.log(chalk.gray('View agent status:'));
        console.log(chalk.cyan('  hive agents list --active'));
        console.log();
      } catch (err) {
        spinner.fail(chalk.red('Failed to assign stories'));
        console.error(err);
        process.exit(1);
      }
    });

    // DB is now closed - safe to start the manager daemon
    // This prevents the race condition where manager loads stale DB state
    if (shouldStartManager) {
      const spinner = ora('Starting manager daemon...').start();
      const started = await startManager(60);
      if (started) {
        spinner.succeed(chalk.green('Manager daemon started (checking every 60s)'));
      } else {
        spinner.info(chalk.gray('Manager daemon already running'));
      }
    }
  });
