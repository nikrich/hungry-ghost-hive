// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { join } from 'path';
import {
  getDatabase,
  getReadOnlyDatabase,
  type DatabaseClient,
  type ReadOnlyDatabaseClient,
} from '../db/client.js';
import { acquireLock } from '../db/lock.js';
import { findHiveRoot, getHivePaths, type HivePaths } from './paths.js';

export interface HiveContext {
  root: string;
  paths: HivePaths;
  db: DatabaseClient;
}

export interface ReadOnlyHiveContext {
  root: string;
  paths: HivePaths;
  db: ReadOnlyDatabaseClient;
}

export interface HiveRootContext {
  root: string;
  paths: HivePaths;
}

function resolveRoot(): { root: string; paths: HivePaths } {
  const root = findHiveRoot();
  if (!root) {
    console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
    process.exit(1);
  }
  const paths = getHivePaths(root);
  return { root, paths };
}

export async function withHiveContext<T>(fn: (ctx: HiveContext) => Promise<T> | T): Promise<T> {
  const { root, paths } = resolveRoot();
  const dbLockPath = join(paths.hiveDir, 'db');

  // Acquire database lock to prevent concurrent access and race conditions
  // This ensures that only one process can read/write the database at a time
  let releaseLock: (() => Promise<void>) | null = null;
  const lockAcquiredAt = Date.now();
  try {
    releaseLock = await acquireLock(dbLockPath, {
      stale: 120000, // 120s stale timeout (increased from 30s to accommodate manager check)
      retries: {
        retries: 20, // More retries for DB lock contention
        minTimeout: 50,
        maxTimeout: 500,
      },
    });
  } catch (err) {
    console.error(
      chalk.red('Failed to acquire database lock. Another process may be accessing the database.')
    );
    throw err;
  }

  const db = await getDatabase(paths.hiveDir);
  try {
    return await fn({ root, paths, db });
  } finally {
    const lockHeldDurationMs = Date.now() - lockAcquiredAt;
    const lockHeldDurationSec = (lockHeldDurationMs / 1000).toFixed(2);

    // Log lock hold duration for telemetry
    if (lockHeldDurationMs > 90000) {
      // Warn if held for more than 90s (75% of stale timeout)
      console.warn(
        chalk.yellow(
          `[TELEMETRY] DB lock held for ${lockHeldDurationSec}s (exceeds 90s warning threshold)`
        )
      );
    } else if (lockHeldDurationMs > 60000) {
      // Info if held for more than 60s
      console.log(
        chalk.gray(
          `[TELEMETRY] DB lock held for ${lockHeldDurationSec}s (exceeds 60s info threshold)`
        )
      );
    }

    db.close();
    if (releaseLock) {
      await releaseLock();
    }
  }
}

export async function withReadOnlyHiveContext<T>(
  fn: (ctx: ReadOnlyHiveContext) => Promise<T> | T
): Promise<T> {
  const { root, paths } = resolveRoot();

  const db = await getReadOnlyDatabase(paths.hiveDir);
  try {
    return await fn({ root, paths, db });
  } finally {
    db.close();
  }
}

export function withHiveRoot<T>(fn: (ctx: HiveRootContext) => T): T {
  const { root, paths } = resolveRoot();
  return fn({ root, paths });
}
