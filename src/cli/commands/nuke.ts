// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import readline from 'readline';
import { queryOne, run } from '../../db/client.js';
import { killAllHiveSessions } from '../../tmux/manager.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

/**
 * Attempt to run DB deletions, handling corrupt database gracefully.
 * If the database is corrupt, offers to delete the DB file since the user
 * is already performing a destructive nuke operation.
 */
async function runDbDeletions(
  dbRef: { db: { run: (sql: string, params?: unknown[]) => void }; save: () => void },
  statements: string[],
  label: string
): Promise<boolean> {
  try {
    for (const sql of statements) {
      run(dbRef.db as Parameters<typeof run>[0], sql);
    }
    dbRef.save();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('malformed') || message.includes('corrupt') || message.includes('disk image')) {
      console.error(chalk.red(`\nDatabase is corrupted: ${message}`));
      console.log(chalk.yellow(`Could not delete ${label} records from the database.`));

      const deleteDb = await confirm(
        chalk.bold('Delete the corrupted database file? (A backup exists at hive.db.bak)')
      );
      if (deleteDb) {
        const root = findHiveRoot();
        if (root) {
          const paths = getHivePaths(root);
          const dbPath = join(paths.hiveDir, 'hive.db');
          // Close won't save a corrupt DB, just remove the file
          for (const ext of ['', '-shm', '-wal']) {
            const filePath = dbPath + ext;
            if (existsSync(filePath)) {
              try {
                unlinkSync(filePath);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
          console.log(chalk.green('Deleted corrupted database. Run any hive command to reinitialize.'));
        }
      } else {
        console.log(chalk.yellow('Database file kept. You can restore from .hive/hive.db.bak manually.'));
      }
      return false;
    }
    // Re-throw non-corruption errors
    throw error;
  }
}

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
          const success = await runDbDeletions(
            db,
            [
              'DELETE FROM pull_requests',
              'UPDATE escalations SET story_id = NULL',
              'DELETE FROM story_dependencies',
              'DELETE FROM stories',
            ],
            'story'
          );

          if (success) {
            console.log(chalk.green(`\nDeleted ${storyCount} stories.`));
          }
        });
      })
  )
  .addCommand(
    new Command('agents')
      .description('Kill all agent tmux sessions and delete from database')
      .option('--force', 'Skip confirmation')
      .action(async (options: { force?: boolean }) => {
        try {
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

            // Kill all hive tmux sessions first (this should always work regardless of DB state)
            const killed = await killAllHiveSessions();
            console.log(chalk.gray(`Killed ${killed} tmux sessions.`));

            // Clear agent references and delete from database
            const success = await runDbDeletions(
              db,
              [
                'UPDATE stories SET assigned_agent_id = NULL',
                'DELETE FROM agent_logs',
                'DELETE FROM escalations',
                'DELETE FROM agents',
              ],
              'agent'
            );

            if (success) {
              console.log(chalk.green(`\nDeleted ${agentCount} agents.`));
            }
          });
        } catch (error) {
          // If the DB itself can't be opened (corruption during load), still kill tmux sessions
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('malformed') || message.includes('corrupt') || message.includes('disk image')) {
            console.error(chalk.red(`\nDatabase is corrupted: ${message}`));
            console.log(chalk.yellow('Killing tmux sessions anyway...'));
            const killed = await killAllHiveSessions();
            console.log(chalk.gray(`Killed ${killed} tmux sessions.`));
            console.log(chalk.yellow('Agent records could not be deleted from the corrupted database.'));
            console.log(chalk.yellow('You can delete .hive/hive.db manually to reset.'));
          } else {
            throw error;
          }
        }
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
          const success = await runDbDeletions(
            db,
            [
              'DELETE FROM pull_requests',
              'UPDATE escalations SET story_id = NULL',
              'DELETE FROM story_dependencies',
              'DELETE FROM stories',
              'DELETE FROM requirements',
            ],
            'requirement'
          );

          if (success) {
            console.log(chalk.green(`\nDeleted ${reqCount} requirements and ${storyCount} stories.`));
          }
        });
      })
  )
  .addCommand(
    new Command('all')
      .description('Kill all agents and delete all data')
      .option('--force', 'Skip confirmation')
      .action(async (options: { force?: boolean }) => {
        try {
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

            // Kill all hive tmux sessions first (always works regardless of DB state)
            const killed = await killAllHiveSessions();
            console.log(chalk.gray(`Killed ${killed} tmux sessions.`));

            // Clear foreign key references first, then delete in order
            const success = await runDbDeletions(
              db,
              [
                'UPDATE stories SET assigned_agent_id = NULL',
                'DELETE FROM pull_requests',
                'DELETE FROM escalations',
                'DELETE FROM agent_logs',
                'DELETE FROM story_dependencies',
                'DELETE FROM stories',
                'DELETE FROM agents',
                'DELETE FROM requirements',
              ],
              'all'
            );

            if (success) {
              console.log(chalk.green('\nAll data deleted.'));
            }
          });
        } catch (error) {
          // If the DB itself can't be opened (corruption during load), still kill tmux sessions
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('malformed') || message.includes('corrupt') || message.includes('disk image')) {
            console.error(chalk.red(`\nDatabase is corrupted: ${message}`));
            console.log(chalk.yellow('Killing tmux sessions anyway...'));
            const killed = await killAllHiveSessions();
            console.log(chalk.gray(`Killed ${killed} tmux sessions.`));
            console.log(chalk.yellow('Data records could not be deleted from the corrupted database.'));
            console.log(chalk.yellow('You can delete .hive/hive.db manually to reset.'));
          } else {
            throw error;
          }
        }
      })
  );
