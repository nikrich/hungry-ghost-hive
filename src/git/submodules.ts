import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';

export interface SubmoduleInfo {
  path: string;
  url: string;
  branch?: string;
  commit: string;
}

/**
 * Add a git submodule
 */
export async function addSubmodule(
  rootDir: string,
  url: string,
  path: string,
  branch: string = 'main'
): Promise<void> {
  const fullPath = join(rootDir, path);

  if (existsSync(fullPath)) {
    throw new Error(`Path already exists: ${fullPath}`);
  }

  await execa('git', ['submodule', 'add', '-b', branch, url, path], {
    cwd: rootDir,
  });
}

/**
 * Initialize submodules
 */
export async function initSubmodules(rootDir: string): Promise<void> {
  await execa('git', ['submodule', 'init'], { cwd: rootDir });
}

/**
 * Update submodules
 */
export async function updateSubmodules(rootDir: string, recursive: boolean = true): Promise<void> {
  const args = ['submodule', 'update'];
  if (recursive) {
    args.push('--recursive');
  }
  await execa('git', args, { cwd: rootDir });
}

/**
 * Initialize and update submodules
 */
export async function initAndUpdateSubmodules(rootDir: string): Promise<void> {
  await execa('git', ['submodule', 'update', '--init', '--recursive'], {
    cwd: rootDir,
  });
}

/**
 * Remove a submodule
 */
export async function removeSubmodule(rootDir: string, path: string): Promise<void> {
  // Deinitialize the submodule
  await execa('git', ['submodule', 'deinit', '-f', path], { cwd: rootDir });

  // Remove from .git/modules
  await execa('git', ['rm', '-f', path], { cwd: rootDir });
}

/**
 * List all submodules
 */
export async function listSubmodules(rootDir: string): Promise<SubmoduleInfo[]> {
  try {
    const { stdout } = await execa('git', ['submodule', 'status'], {
      cwd: rootDir,
    });

    if (!stdout.trim()) {
      return [];
    }

    const submodules: SubmoduleInfo[] = [];

    for (const line of stdout.split('\n')) {
      const match = line.match(/^[\s+-]?([a-f0-9]+)\s+(\S+)(?:\s+\((.+)\))?/);
      if (match) {
        const [, commit, path, branch] = match;
        submodules.push({
          path,
          url: await getSubmoduleUrl(rootDir, path),
          branch: branch?.replace('heads/', ''),
          commit,
        });
      }
    }

    return submodules;
  } catch {
    return [];
  }
}

/**
 * Get the URL of a submodule
 */
export async function getSubmoduleUrl(rootDir: string, path: string): Promise<string> {
  try {
    const { stdout } = await execa(
      'git',
      ['config', '--file', '.gitmodules', `submodule.${path}.url`],
      { cwd: rootDir }
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Check if a path is a submodule
 */
export async function isSubmodule(rootDir: string, path: string): Promise<boolean> {
  const submodules = await listSubmodules(rootDir);
  return submodules.some((s) => s.path === path);
}

/**
 * Sync submodule URLs
 */
export async function syncSubmodules(rootDir: string): Promise<void> {
  await execa('git', ['submodule', 'sync'], { cwd: rootDir });
}

/**
 * Fetch updates for all submodules
 */
export async function fetchSubmodules(rootDir: string): Promise<void> {
  await execa('git', ['submodule', 'foreach', 'git', 'fetch'], {
    cwd: rootDir,
  });
}
