// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { join } from 'path';
import { loadConfig } from '../config/loader.js';
import {
  getDatabase,
  getReadOnlyDatabase,
  type DatabaseClient,
  type ReadOnlyDatabaseClient,
} from '../db/client.js';
import { acquireLock } from '../db/lock.js';
import { createPostgresProvider } from '../db/postgres-provider.js';
import { findHiveRoot, getHivePaths, getWorkspaceId, type HivePaths } from './paths.js';

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

/**
 * Check if this workspace is running in distributed (Postgres) mode.
 */
function isDistributedMode(paths: HivePaths): boolean {
  try {
    const config = loadConfig(paths.hiveDir);
    return config.distributed === true;
  } catch {
    return false;
  }
}

export async function withHiveContext<T>(fn: (ctx: HiveContext) => Promise<T> | T): Promise<T> {
  const { root, paths } = resolveRoot();

  if (isDistributedMode(paths)) {
    return withDistributedHiveContext(root, paths, fn);
  }

  const dbLockPath = join(paths.hiveDir, 'db');

  // Acquire database lock to prevent concurrent access and race conditions
  // This ensures that only one process can read/write the database at a time
  let releaseLock: (() => Promise<void>) | null = null;
  const lockAcquiredAt = Date.now();
  try {
    releaseLock = await acquireLock(dbLockPath, {
      stale: 30000, // 30s stale timeout (per-step locking keeps individual holds brief)
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
    if (lockHeldDurationMs > 20000) {
      // Warn if held for more than 20s (67% of stale timeout)
      console.warn(
        chalk.yellow(
          `[TELEMETRY] DB lock held for ${lockHeldDurationSec}s (exceeds 20s warning threshold)`
        )
      );
    } else if (lockHeldDurationMs > 10000) {
      // Info if held for more than 10s
      console.log(
        chalk.gray(
          `[TELEMETRY] DB lock held for ${lockHeldDurationSec}s (exceeds 10s info threshold)`
        )
      );
    }

    db.close();
    if (releaseLock) {
      await releaseLock();
    }
  }
}

async function withDistributedHiveContext<T>(
  root: string,
  paths: HivePaths,
  fn: (ctx: HiveContext) => Promise<T> | T
): Promise<T> {
  const workspaceId = getWorkspaceId(paths);
  if (!workspaceId) {
    throw new Error(
      'Distributed mode is enabled but workspace.id file is missing. ' +
        'Re-run "hive init --distributed" to fix.'
    );
  }

  const { join } = await import('path');
  const envPath = join(root, '.env');
  const provider = await createPostgresProvider(workspaceId, envPath);
  // Create a DatabaseClient-compatible wrapper around the Postgres provider
  const db: DatabaseClient = {
    db: null as never, // No sql.js database in distributed mode
    provider,
    close: () => {
      provider.close();
    },
    save: () => {
      provider.save();
    },
    runMigrations: () => {
      provider.runMigrations();
    },
  };

  try {
    return await fn({ root, paths, db });
  } finally {
    await provider.close();
  }
}

export async function withReadOnlyHiveContext<T>(
  fn: (ctx: ReadOnlyHiveContext) => Promise<T> | T
): Promise<T> {
  const { root, paths } = resolveRoot();

  if (isDistributedMode(paths)) {
    return withDistributedReadOnlyHiveContext(root, paths, fn);
  }

  const db = await getReadOnlyDatabase(paths.hiveDir);
  try {
    return await fn({ root, paths, db });
  } finally {
    db.close();
  }
}

async function withDistributedReadOnlyHiveContext<T>(
  root: string,
  paths: HivePaths,
  fn: (ctx: ReadOnlyHiveContext) => Promise<T> | T
): Promise<T> {
  const workspaceId = getWorkspaceId(paths);
  if (!workspaceId) {
    throw new Error(
      'Distributed mode is enabled but workspace.id file is missing. ' +
        'Re-run "hive init --distributed" to fix.'
    );
  }

  const { join } = await import('path');
  const envPath = join(root, '.env');
  const provider = await createPostgresProvider(workspaceId, envPath);
  const db: ReadOnlyDatabaseClient = {
    db: null as never, // No sql.js database in distributed mode
    provider,
    close: () => {
      provider.close();
    },
  };

  try {
    return await fn({ root, paths, db });
  } finally {
    await provider.close();
  }
}

export function withHiveRoot<T>(fn: (ctx: HiveRootContext) => T): T {
  const { root, paths } = resolveRoot();
  return fn({ root, paths });
}
