import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { startManager, isManagerRunning } from '../../tmux/manager.js';
import { getPlannedStories } from '../../db/queries/stories.js';
import { getAgentsByTeam } from '../../db/queries/agents.js';
import { getAllTeams } from '../../db/queries/teams.js';

function simulateAssignments(db: any, config: any) {
  const plannedStories = getPlannedStories(db);
  const teams = getAllTeams(db);
  const assignments: Array<{ storyId: string; storyName: string; teamName: string; agentType: string; complexity: number }> = [];
  const teamSummary: Array<{ teamName: string; plannedCount: number; idleAgents: number }> = [];

  // Analyze each team
  for (const team of teams) {
    const teamStories = plannedStories.filter(s => s.team_id === team.id);
    const idleAgents = getAgentsByTeam(db, team.id).filter(a => a.status === 'idle' && a.type !== 'qa');

    if (teamStories.length > 0) {
      teamSummary.push({
        teamName: team.name,
        plannedCount: teamStories.length,
        idleAgents: idleAgents.length,
      });

      // Simulate assignments for each story
      for (const story of teamStories) {
        const complexity = story.complexity_score || 5;
        let agentType = 'senior';

        if (complexity <= config.scaling.junior_max_complexity) {
          agentType = 'junior';
        } else if (complexity <= config.scaling.intermediate_max_complexity) {
          agentType = 'intermediate';
        }

        assignments.push({
          storyId: story.id,
          storyName: story.title || story.id,
          teamName: team.name,
          agentType,
          complexity,
        });
      }
    }
  }

  return { assignments, teamSummary };
}

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
        console.log(chalk.yellow('\n📋 Dry run - no changes will be made\n'));

        const { assignments, teamSummary } = simulateAssignments(db.db, config);

        if (assignments.length === 0) {
          console.log(chalk.gray('No planned stories to assign'));
          console.log();
          return;
        }

        // Show team summary
        if (teamSummary.length > 0) {
          console.log(chalk.cyan('Team Summary:'));
          for (const team of teamSummary) {
            console.log(chalk.gray(`  ${team.teamName}: ${team.plannedCount} planned stories, ${team.idleAgents} idle agents`));
          }
          console.log();
        }

        // Show what would be assigned
        console.log(chalk.cyan('Would assign:'));
        for (const assignment of assignments) {
          const icon = assignment.agentType === 'junior' ? '👶' : assignment.agentType === 'intermediate' ? '👨‍💼' : '👔';
          console.log(
            chalk.gray(`  ${icon} [${assignment.storyId}] ${assignment.storyName}`)
            + ` → ${chalk.yellow(assignment.agentType)} (complexity: ${assignment.complexity})`
          );
        }
        console.log();
        console.log(chalk.green(`Total: ${assignments.length} stories would be assigned`));
        console.log();
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
