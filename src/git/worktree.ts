// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';

export interface RemoveWorktreeResult {
  success: boolean;
  error?: string;
  fullWorktreePath: string;
}

/**
 * Remove a git worktree at the given path.
 *
 * @param rootDir   - The root directory of the hive workspace
 * @param worktreePath - Relative worktree path (e.g. "repos/team-agent-1")
 * @param options.timeout - Git command timeout in ms (default: 30000)
 * @returns Result indicating success/failure with error details
 */
export function removeWorktree(
  rootDir: string,
  worktreePath: string,
  options?: { timeout?: number }
): RemoveWorktreeResult {
  const fullWorktreePath = `${rootDir}/${worktreePath}`;

  if (!worktreePath) {
    return { success: true, fullWorktreePath };
  }

  if (!existsSync(fullWorktreePath)) {
    if (process.env.HIVE_DEBUG) {
      console.log(
        `[debug] worktree path ${fullWorktreePath} does not exist on disk, skipping removal`
      );
    }
    return { success: true, fullWorktreePath };
  }

  try {
    execSync(`git worktree remove "${fullWorktreePath}" --force`, {
      cwd: rootDir,
      stdio: 'pipe',
      timeout: options?.timeout ?? 30000,
    });
    return { success: true, fullWorktreePath };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    // If git doesn't recognize it as a worktree but the directory exists,
    // fall back to removing the directory directly (common after interrupted operations)
    if (errorMsg.includes('not a working tree') && existsSync(fullWorktreePath)) {
      try {
        rmSync(fullWorktreePath, { recursive: true, force: true });
        return { success: true, fullWorktreePath };
      } catch (rmErr) {
        return {
          success: false,
          error: `git worktree failed and rm fallback also failed: ${rmErr instanceof Error ? rmErr.message : 'Unknown error'}`,
          fullWorktreePath,
        };
      }
    }
    return {
      success: false,
      error: errorMsg,
      fullWorktreePath,
    };
  }
}
