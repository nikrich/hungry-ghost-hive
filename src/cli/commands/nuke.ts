// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import readline from 'readline';
import { queryOne, run } from '../../db/client.js';
import { killAllHiveSessions } from '../../tmux/manager.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(`${message} (yes/no): `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

export const nukeCommand = new Command('nuke')
  .description('Delete data (use with caution)')
  .addCommand(
    new Command('stories')
      .description('Delete all stories')
      .option('--force', 'Skip confirmation')
      .action(async (options: { force?: boolean }) => {
        await withHiveContext(async ({ db }) => {
          // Count stories
          const count = queryOne<{ count: number }>(db.db, 'SELECT COUNT(*) as count FROM stories');
          const storyCount = count?.count || 0;

          if (storyCount === 0) {
            console.log(chalk.yellow('No stories to delete.'));
            return;
          }

          console.log(
            chalk.yellow(`\nThis will delete ${storyCount} stories and their dependencies.`)
          );
          console.log(chalk.red('This action cannot be undone.\n'));

          if (!options.force) {
            const confirmed = await confirm(
              chalk.bold('Are you sure you want to delete all stories?')
            );
            if (!confirmed) {
              console.log(chalk.gray('Aborted.'));
              return;
            }
          }

          // Delete in order to respect foreign keys
          run(db.db, 'DELETE FROM pull_requests');
          run(db.db, 'UPDATE escalations SET story_id = NULL');
          run(db.db, 'DELETE FROM story_dependencies');
          run(db.db, 'DELETE FROM stories');
          db.save();

          console.log(chalk.green(`\nDeleted ${storyCount} stories.`));
        });
      })
  )
  .addCommand(
    new Command('agents')
      .description('Kill all agent tmux sessions and delete from database')
      .option('--force', 'Skip confirmation')
      .action(async (options: { force?: boolean }) => {
        await withHiveContext(async ({ db }) => {
          const count = queryOne<{ count: number }>(db.db, 'SELECT COUNT(*) as count FROM agents');
          const agentCount = count?.count || 0;

          console.log(
            chalk.yellow(`\nThis will kill all hive tmux sessions and delete ${agentCount} agents.`)
          );
          console.log(chalk.red('This action cannot be undone.\n'));

          if (!options.force) {
            const confirmed = await confirm(
              chalk.bold('Are you sure you want to kill all agents?')
            );
            if (!confirmed) {
              console.log(chalk.gray('Aborted.'));
              return;
            }
          }

          // Kill all hive tmux sessions
          const killed = await killAllHiveSessions();
          console.log(chalk.gray(`Killed ${killed} tmux sessions.`));

          // Clear agent references from stories first
          run(db.db, 'UPDATE stories SET assigned_agent_id = NULL');
          // Delete from database
          run(db.db, 'DELETE FROM agent_logs');
          run(db.db, 'DELETE FROM escalations');
          run(db.db, 'DELETE FROM agents');
          db.save();

          console.log(chalk.green(`\nDeleted ${agentCount} agents.`));
        });
      })
  )
  .addCommand(
    new Command('requirements')
      .description('Delete all requirements')
      .option('--force', 'Skip confirmation')
      .action(async (options: { force?: boolean }) => {
        await withHiveContext(async ({ db }) => {
          const count = queryOne<{ count: number }>(
            db.db,
            'SELECT COUNT(*) as count FROM requirements'
          );
          const reqCount = count?.count || 0;

          if (reqCount === 0) {
            console.log(chalk.yellow('No requirements to delete.'));
            return;
          }

          const storyCount =
            queryOne<{ count: number }>(db.db, 'SELECT COUNT(*) as count FROM stories')?.count || 0;

          console.log(
            chalk.yellow(
              `\nThis will delete ${reqCount} requirements and ${storyCount} related stories.`
            )
          );
          console.log(chalk.red('This action cannot be undone.\n'));

          if (!options.force) {
            const confirmed = await confirm(
              chalk.bold('Are you sure you want to delete all requirements?')
            );
            if (!confirmed) {
              console.log(chalk.gray('Aborted.'));
              return;
            }
          }

          // Delete stories first (they reference requirements)
          run(db.db, 'DELETE FROM pull_requests');
          run(db.db, 'UPDATE escalations SET story_id = NULL');
          run(db.db, 'DELETE FROM story_dependencies');
          run(db.db, 'DELETE FROM stories');
          run(db.db, 'DELETE FROM requirements');
          db.save();

          console.log(chalk.green(`\nDeleted ${reqCount} requirements and ${storyCount} stories.`));
        });
      })
  )
  .addCommand(
    new Command('all')
      .description('Kill all agents and delete all data')
      .option('--force', 'Skip confirmation')
      .action(async (options: { force?: boolean }) => {
        await withHiveContext(async ({ db }) => {
          console.log(chalk.red('\nThis will:'));
          console.log(chalk.yellow('  - Kill all hive tmux sessions'));
          console.log(chalk.yellow('  - Delete all stories and dependencies'));
          console.log(chalk.yellow('  - Delete all agents and logs'));
          console.log(chalk.yellow('  - Delete all requirements'));
          console.log(chalk.yellow('  - Delete all escalations'));
          console.log(chalk.yellow('  - Delete all pull requests'));
          console.log(chalk.red('\nThis action cannot be undone.\n'));

          if (!options.force) {
            const confirmed = await confirm(
              chalk.bold('Are you sure you want to nuke EVERYTHING?')
            );
            if (!confirmed) {
              console.log(chalk.gray('Aborted.'));
              return;
            }
          }

          // Kill all hive tmux sessions first
          const killed = await killAllHiveSessions();
          console.log(chalk.gray(`Killed ${killed} tmux sessions.`));

          // Clear foreign key references first
          run(db.db, 'UPDATE stories SET assigned_agent_id = NULL');
          // Delete in order to respect foreign keys
          run(db.db, 'DELETE FROM pull_requests');
          run(db.db, 'DELETE FROM escalations');
          run(db.db, 'DELETE FROM agent_logs');
          run(db.db, 'DELETE FROM story_dependencies');
          run(db.db, 'DELETE FROM stories');
          run(db.db, 'DELETE FROM agents');
          run(db.db, 'DELETE FROM requirements');
          db.save();

          console.log(chalk.green('\nAll data deleted.'));
        });
      })
  );
