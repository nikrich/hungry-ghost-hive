// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execSync } from 'child_process';

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

  try {
    execSync(`git worktree remove "${fullWorktreePath}" --force`, {
      cwd: rootDir,
      stdio: 'pipe',
      timeout: options?.timeout ?? 30000,
    });
    return { success: true, fullWorktreePath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      fullWorktreePath,
    };
  }
}
