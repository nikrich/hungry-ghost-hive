// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execa } from 'execa';

export interface BranchInfo {
  name: string;
  current: boolean;
  remote?: string;
  upstream?: string;
  lastCommit: string;
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(workDir: string): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current'], {
    cwd: workDir,
  });
  return stdout.trim();
}

/**
 * List all local branches
 */
export async function listBranches(workDir: string): Promise<BranchInfo[]> {
  const { stdout } = await execa(
    'git',
    ['branch', '-v', '--format=%(refname:short)|%(objectname:short)|%(HEAD)'],
    { cwd: workDir }
  );

  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [name, lastCommit, head] = line.split('|');
      return {
        name,
        current: head === '*',
        lastCommit,
      };
    });
}

/**
 * Create a new branch
 */
export async function createBranch(
  workDir: string,
  name: string,
  startPoint?: string
): Promise<void> {
  const args = ['branch', name];
  if (startPoint) {
    args.push(startPoint);
  }
  await execa('git', args, { cwd: workDir });
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(
  workDir: string,
  name: string,
  create: boolean = false
): Promise<void> {
  const args = ['checkout'];
  if (create) {
    args.push('-b');
  }
  args.push(name);
  await execa('git', args, { cwd: workDir });
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  workDir: string,
  name: string,
  force: boolean = false
): Promise<void> {
  const args = ['branch', force ? '-D' : '-d', name];
  await execa('git', args, { cwd: workDir });
}

/**
 * Check if branch exists
 */
export async function branchExists(workDir: string, name: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--verify', name], { cwd: workDir });
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Get branch tracking info
 */
export async function getBranchTracking(
  workDir: string,
  branch: string
): Promise<{
  upstream: string | null;
  ahead: number;
  behind: number;
}> {
  try {
    const { stdout: upstream } = await execa(
      'git',
      ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`],
      { cwd: workDir }
    );

    const { stdout: counts } = await execa(
      'git',
      ['rev-list', '--left-right', '--count', `${upstream.trim()}...${branch}`],
      { cwd: workDir }
    );

    const [behind, ahead] = counts.trim().split('\t').map(Number);

    return {
      upstream: upstream.trim(),
      ahead,
      behind,
    };
  } catch (_error) {
    return { upstream: null, ahead: 0, behind: 0 };
  }
}

/**
 * Push branch to remote
 */
export async function pushBranch(
  workDir: string,
  branch: string,
  remote: string = 'origin',
  setUpstream: boolean = false
): Promise<void> {
  const args = ['push', remote, branch];
  if (setUpstream) {
    args.splice(1, 0, '-u');
  }
  await execa('git', args, { cwd: workDir });
}

/**
 * Create and checkout a feature branch
 */
export async function createFeatureBranch(
  workDir: string,
  storyId: string,
  description: string,
  baseBranch: string = 'main'
): Promise<string> {
  // Normalize the description for branch name
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);

  const branchName = `feature/${storyId.toLowerCase()}-${slug}`;

  // Make sure we're on the base branch and up to date
  await checkoutBranch(workDir, baseBranch);

  try {
    await execa('git', ['pull', 'origin', baseBranch], { cwd: workDir });
  } catch (_error) {
    // Pull might fail if no remote tracking, continue anyway
  }

  // Create and checkout the feature branch
  await checkoutBranch(workDir, branchName, true);

  return branchName;
}

/**
 * Merge a branch
 */
export async function mergeBranch(
  workDir: string,
  branch: string,
  noFf: boolean = true
): Promise<void> {
  const args = ['merge'];
  if (noFf) {
    args.push('--no-ff');
  }
  args.push(branch);
  await execa('git', args, { cwd: workDir });
}
