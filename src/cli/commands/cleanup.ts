import chalk from 'chalk';
import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import readline from 'readline';
import { getDatabase, type DatabaseClient } from '../../db/client.js';
import { getAllAgents } from '../../db/queries/agents.js';
import {
  getStoriesWithOrphanedAssignments,
  updateStoryAssignment,
} from '../../db/queries/stories.js';
import { getHiveSessions, isTmuxSessionRunning } from '../../tmux/manager.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';

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

interface CleanupStats {
  orphanedWorktrees: string[];
  staleLockFiles: string[];
  deadTmuxSessions: string[];
  orphanedStories: Array<{ id: string; agent_id: string }>;
  totalIssuesFound: number;
}

async function findOrphanedWorktrees(root: string, db: DatabaseClient): Promise<string[]> {
  const reposDir = path.join(root, 'repos');
  const orphaned: string[] = [];

  if (!existsSync(reposDir)) {
    return orphaned;
  }

  try {
    const entries = await fs.readdir(reposDir, { withFileTypes: true });
    const allAgents = getAllAgents(db.db);
    const agentWorktrees = new Set(
      allAgents.filter(a => a.worktree_path).map(a => a.worktree_path)
    );

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const worktreePath = path.join('repos', entry.name);
        // Check if this is a hive worktree (matches pattern repos/*-*/)
        if (
          entry.name.match(/^[a-zA-Z0-9]+-[a-zA-Z0-9]+(-\d+)?$/) &&
          !agentWorktrees.has(worktreePath)
        ) {
          orphaned.push(worktreePath);
        }
      }
    }
  } catch (err) {
    console.error(
      chalk.yellow(
        `Warning: Could not scan repos directory: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    );
  }

  return orphaned;
}

async function findStaleLockFiles(hiveDir: string): Promise<string[]> {
  const staleLockFiles: string[] = [];
  const staleThresholdMs = 2 * 60 * 1000; // 2 minutes (manager stale threshold)

  try {
    const entries = await fs.readdir(hiveDir, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (entry.name.endsWith('.lock')) {
        const fullPath = path.join(hiveDir, entry.name);
        const stats = await fs.stat(fullPath);
        const ageMs = now - stats.mtimeMs;

        if (ageMs > staleThresholdMs) {
          staleLockFiles.push(path.relative(path.dirname(hiveDir), fullPath));
        }
      }
    }
  } catch (err) {
    console.error(
      chalk.yellow(
        `Warning: Could not scan hive directory for lock files: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    );
  }

  return staleLockFiles;
}

async function findDeadTmuxSessions(db: DatabaseClient): Promise<string[]> {
  const deadSessions: string[] = [];

  try {
    const hiveSessions = await getHiveSessions();
    const allAgents = getAllAgents(db.db);
    const agentSessionNames = new Set(
      allAgents.filter(a => a.tmux_session).map(a => a.tmux_session)
    );

    // Find tmux sessions that don't have active agent DB entries
    for (const session of hiveSessions) {
      if (!agentSessionNames.has(session.name)) {
        deadSessions.push(session.name);
      }
    }
  } catch (err) {
    console.error(
      chalk.yellow(
        `Warning: Could not list tmux sessions: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    );
  }

  return deadSessions;
}

function findOrphanedAssignments(db: DatabaseClient): Array<{ id: string; agent_id: string }> {
  try {
    return getStoriesWithOrphanedAssignments(db.db);
  } catch (err) {
    console.error(
      chalk.yellow(
        `Warning: Could not find orphaned story assignments: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    );
    return [];
  }
}

async function cleanupOrphanedWorktrees(
  root: string,
  orphaned: string[],
  dryRun: boolean
): Promise<number> {
  let cleaned = 0;

  for (const worktreePath of orphaned) {
    const fullPath = path.join(root, worktreePath);
    try {
      if (dryRun) {
        console.log(chalk.gray(`  Would remove: ${worktreePath}`));
      } else {
        await execa('git', ['worktree', 'remove', fullPath, '--force'], { cwd: root });
        console.log(chalk.gray(`  ✓ Removed: ${worktreePath}`));
        cleaned++;
      }
    } catch (err) {
      console.error(
        chalk.yellow(
          `  Warning: Failed to remove ${worktreePath}: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      );
    }
  }

  return cleaned;
}

async function cleanupStaleLockFiles(staleLockFiles: string[], dryRun: boolean): Promise<number> {
  let cleaned = 0;

  for (const lockFile of staleLockFiles) {
    try {
      if (dryRun) {
        console.log(chalk.gray(`  Would remove: ${lockFile}`));
      } else {
        await fs.unlink(lockFile);
        console.log(chalk.gray(`  ✓ Removed: ${lockFile}`));
        cleaned++;
      }
    } catch (err) {
      console.error(
        chalk.yellow(
          `  Warning: Failed to remove ${lockFile}: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      );
    }
  }

  return cleaned;
}

async function cleanupDeadTmuxSessions(deadSessions: string[], dryRun: boolean): Promise<number> {
  let cleaned = 0;

  for (const sessionName of deadSessions) {
    try {
      const isRunning = await isTmuxSessionRunning(sessionName);
      if (isRunning) {
        if (dryRun) {
          console.log(chalk.gray(`  Would kill: ${sessionName}`));
        } else {
          await execa('tmux', ['kill-session', '-t', sessionName]);
          console.log(chalk.gray(`  ✓ Killed: ${sessionName}`));
          cleaned++;
        }
      }
    } catch (err) {
      console.error(
        chalk.yellow(
          `  Warning: Failed to kill ${sessionName}: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      );
    }
  }

  return cleaned;
}

function cleanupOrphanedAssignments(
  db: DatabaseClient,
  orphaned: Array<{ id: string; agent_id: string }>,
  dryRun: boolean
): number {
  let cleaned = 0;

  for (const assignment of orphaned) {
    try {
      if (dryRun) {
        console.log(chalk.gray(`  Would unassign: ${assignment.id} from ${assignment.agent_id}`));
      } else {
        updateStoryAssignment(db.db, assignment.id, null);
        console.log(chalk.gray(`  ✓ Unassigned: ${assignment.id}`));
        cleaned++;
      }
    } catch (err) {
      console.error(
        chalk.yellow(
          `  Warning: Failed to unassign ${assignment.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      );
    }
  }

  return cleaned;
}

export const cleanupCommand = new Command('cleanup')
  .description('Clean up orphaned resources (worktrees, lock files, dead sessions)')
  .option('--dry-run', 'Show what would be cleaned up without actually cleaning')
  .option('--force', 'Skip confirmation')
  .option('--worktrees', 'Only clean up orphaned git worktrees')
  .option('--locks', 'Only clean up stale lock files')
  .option('--sessions', 'Only clean up dead tmux sessions')
  .option('--assignments', 'Only clean up orphaned story assignments')
  .action(
    async (options: {
      dryRun?: boolean;
      force?: boolean;
      worktrees?: boolean;
      locks?: boolean;
      sessions?: boolean;
      assignments?: boolean;
    }) => {
      const root = findHiveRoot();
      if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
      }

      const paths = getHivePaths(root);
      const db = await getDatabase(paths.hiveDir);

      try {
        // Determine what to cleanup
        const cleanupAll =
          !options.worktrees && !options.locks && !options.sessions && !options.assignments;
        const shouldCleanupWorktrees = cleanupAll || options.worktrees;
        const shouldCleanupLocks = cleanupAll || options.locks;
        const shouldCleanupSessions = cleanupAll || options.sessions;
        const shouldCleanupAssignments = cleanupAll || options.assignments;

        console.log(chalk.bold('\n🔍 Scanning for orphaned resources...\n'));

        const stats: CleanupStats = {
          orphanedWorktrees: [],
          staleLockFiles: [],
          deadTmuxSessions: [],
          orphanedStories: [],
          totalIssuesFound: 0,
        };

        // Scan for orphaned resources
        if (shouldCleanupWorktrees) {
          stats.orphanedWorktrees = await findOrphanedWorktrees(root, db);
        }
        if (shouldCleanupLocks) {
          stats.staleLockFiles = await findStaleLockFiles(paths.hiveDir);
        }
        if (shouldCleanupSessions) {
          stats.deadTmuxSessions = await findDeadTmuxSessions(db);
        }
        if (shouldCleanupAssignments) {
          stats.orphanedStories = findOrphanedAssignments(db);
        }

        stats.totalIssuesFound =
          stats.orphanedWorktrees.length +
          stats.staleLockFiles.length +
          stats.deadTmuxSessions.length +
          stats.orphanedStories.length;

        // Report findings
        if (stats.totalIssuesFound === 0) {
          console.log(chalk.green('✓ No orphaned resources found.'));
          return;
        }

        console.log(chalk.yellow(`Found ${stats.totalIssuesFound} orphaned resource(s):\n`));

        if (stats.orphanedWorktrees.length > 0) {
          console.log(chalk.cyan(`  Orphaned worktrees (${stats.orphanedWorktrees.length}):`));
          for (const worktree of stats.orphanedWorktrees) {
            console.log(chalk.gray(`    - ${worktree}`));
          }
          console.log();
        }

        if (stats.staleLockFiles.length > 0) {
          console.log(chalk.cyan(`  Stale lock files (${stats.staleLockFiles.length}):`));
          for (const lockFile of stats.staleLockFiles) {
            console.log(chalk.gray(`    - ${lockFile}`));
          }
          console.log();
        }

        if (stats.deadTmuxSessions.length > 0) {
          console.log(chalk.cyan(`  Dead tmux sessions (${stats.deadTmuxSessions.length}):`));
          for (const session of stats.deadTmuxSessions) {
            console.log(chalk.gray(`    - ${session}`));
          }
          console.log();
        }

        if (stats.orphanedStories.length > 0) {
          console.log(
            chalk.cyan(`  Orphaned story assignments (${stats.orphanedStories.length}):`)
          );
          for (const story of stats.orphanedStories) {
            console.log(chalk.gray(`    - ${story.id} (assigned to ${story.agent_id})`));
          }
          console.log();
        }

        if (options.dryRun) {
          console.log(chalk.yellow('Dry run mode - no resources will be deleted.\n'));
          return;
        }

        // Confirm cleanup
        if (!options.force) {
          const confirmed = await confirm(
            chalk.bold(`Clean up ${stats.totalIssuesFound} orphaned resource(s)?`)
          );
          if (!confirmed) {
            console.log(chalk.gray('Aborted.\n'));
            return;
          }
        }

        console.log(chalk.bold('\n🧹 Cleaning up resources...\n'));

        let totalCleaned = 0;

        // Clean up resources
        if (stats.orphanedWorktrees.length > 0) {
          console.log(chalk.cyan('Removing orphaned worktrees:'));
          const cleaned = await cleanupOrphanedWorktrees(root, stats.orphanedWorktrees, false);
          totalCleaned += cleaned;
          console.log();
        }

        if (stats.staleLockFiles.length > 0) {
          console.log(chalk.cyan('Removing stale lock files:'));
          const cleaned = await cleanupStaleLockFiles(stats.staleLockFiles, false);
          totalCleaned += cleaned;
          console.log();
        }

        if (stats.deadTmuxSessions.length > 0) {
          console.log(chalk.cyan('Killing dead tmux sessions:'));
          const cleaned = await cleanupDeadTmuxSessions(stats.deadTmuxSessions, false);
          totalCleaned += cleaned;
          console.log();
        }

        if (stats.orphanedStories.length > 0) {
          console.log(chalk.cyan('Unassigning orphaned stories:'));
          const cleaned = cleanupOrphanedAssignments(db, stats.orphanedStories, false);
          totalCleaned += cleaned;
          db.save();
          console.log();
        }

        console.log(chalk.green(`✓ Successfully cleaned up ${totalCleaned} resource(s).\n`));
      } finally {
        db.close();
      }
    }
  );
