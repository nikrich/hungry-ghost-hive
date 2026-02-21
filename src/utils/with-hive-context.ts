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

export interface WithHiveContextOptions {
  suppressLockErrors?: boolean;
  lockRetries?: {
    retries?: number;
    minTimeout?: number;
    maxTimeout?: number;
  };
  lockStaleMs?: number;
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

export async function withHiveContext<T>(
  fn: (ctx: HiveContext) => Promise<T> | T,
  options: WithHiveContextOptions = {}
): Promise<T> {
  const { root, paths } = resolveRoot();
  const dbLockPath = join(paths.hiveDir, 'db');

  // Acquire database lock to prevent concurrent access and race conditions
  // This ensures that only one process can read/write the database at a time
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireLock(dbLockPath, {
      stale: options.lockStaleMs ?? 30000, // 30s stale timeout
      retries: options.lockRetries ?? {
        retries: 20, // More retries for DB lock contention
        minTimeout: 50,
        maxTimeout: 500,
      },
    });
  } catch (err) {
    if (!options.suppressLockErrors) {
      console.error(
        chalk.red('Failed to acquire database lock. Another process may be accessing the database.')
      );
    }
    throw err;
  }

  const db = await getDatabase(paths.hiveDir);
  try {
    return await fn({ root, paths, db });
  } finally {
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
