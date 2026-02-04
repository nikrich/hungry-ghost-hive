import { existsSync } from 'fs';
import { join, resolve } from 'path';

export const HIVE_DIR_NAME = '.hive';
export const REPOS_DIR_NAME = 'repos';
export const AGENTS_DIR_NAME = 'agents';
export const LOGS_DIR_NAME = 'logs';

export interface HivePaths {
  root: string;
  hiveDir: string;
  dbPath: string;
  configPath: string;
  agentsDir: string;
  logsDir: string;
  reposDir: string;
}

export function findHiveRoot(startDir: string = process.cwd()): string | null {
  let currentDir = resolve(startDir);

  while (currentDir !== '/') {
    const hiveDir = join(currentDir, HIVE_DIR_NAME);
    if (existsSync(hiveDir)) {
      return currentDir;
    }
    currentDir = resolve(currentDir, '..');
  }

  return null;
}

export function getHivePaths(rootDir: string): HivePaths {
  const hiveDir = join(rootDir, HIVE_DIR_NAME);

  return {
    root: rootDir,
    hiveDir,
    dbPath: join(hiveDir, 'hive.db'),
    configPath: join(hiveDir, 'hive.config.yaml'),
    agentsDir: join(hiveDir, AGENTS_DIR_NAME),
    logsDir: join(hiveDir, LOGS_DIR_NAME),
    reposDir: join(rootDir, REPOS_DIR_NAME),
  };
}

export function isHiveWorkspace(dir: string): boolean {
  return existsSync(join(dir, HIVE_DIR_NAME));
}
