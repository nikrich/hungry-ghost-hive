import chalk from 'chalk';
import { getDatabase, type DatabaseClient } from '../db/client.js';
import { findHiveRoot, getHivePaths, type HivePaths } from './paths.js';

export interface HiveContext {
  root: string;
  paths: HivePaths;
  db: DatabaseClient;
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

export async function withHiveContext<T>(
  fn: (ctx: HiveContext) => Promise<T> | T,
): Promise<T> {
  const { root, paths } = resolveRoot();
  const db = await getDatabase(paths.hiveDir);

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
