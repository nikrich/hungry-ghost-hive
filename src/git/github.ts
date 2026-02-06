import { execa } from 'execa';

export interface PRCreateOptions {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
}

export interface PRInfo {
  number: number;
  url: string;
  title: string;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PRReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
  body: string;
}

/**
 * Check if gh CLI is available and authenticated
 */
export async function isGitHubCLIAvailable(): Promise<boolean> {
  try {
    await execa('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  workDir: string,
  options: PRCreateOptions
): Promise<{ number: number; url: string }> {
  const args = [
    'pr',
    'create',
    '--title',
    options.title,
    '--body',
    options.body,
    '--base',
    options.baseBranch,
    '--head',
    options.headBranch,
  ];

  if (options.draft) {
    args.push('--draft');
  }

  if (options.labels && options.labels.length > 0) {
    args.push('--label', options.labels.join(','));
  }

  if (options.assignees && options.assignees.length > 0) {
    args.push('--assignee', options.assignees.join(','));
  }

  const { stdout } = await execa('gh', args, { cwd: workDir });
  const url = stdout.trim();

  // Extract PR number from URL
  const numberMatch = url.match(/\/pull\/(\d+)/);
  const number = numberMatch ? parseInt(numberMatch[1], 10) : 0;

  return { number, url };
}

/**
 * Get pull request information
 */
export async function getPullRequest(workDir: string, prNumber: number): Promise<PRInfo> {
  const { stdout } = await execa(
    'gh',
    [
      'pr',
      'view',
      prNumber.toString(),
      '--json',
      'number,url,title,state,headRefName,baseRefName,additions,deletions,changedFiles',
    ],
    { cwd: workDir }
  );

  const data = JSON.parse(stdout);

  return {
    number: data.number,
    url: data.url,
    title: data.title,
    state: data.state.toLowerCase() as PRInfo['state'],
    headBranch: data.headRefName,
    baseBranch: data.baseRefName,
    additions: data.additions,
    deletions: data.deletions,
    changedFiles: data.changedFiles,
  };
}

/**
 * List open pull requests
 */
export async function listPullRequests(
  workDir: string,
  state: 'open' | 'closed' | 'all' = 'open'
): Promise<PRInfo[]> {
  const { stdout } = await execa(
    'gh',
    [
      'pr',
      'list',
      '--state',
      state,
      '--json',
      'number,url,title,state,headRefName,baseRefName,additions,deletions,changedFiles',
    ],
    { cwd: workDir }
  );

  const data = JSON.parse(stdout) as Array<{
    number: number;
    url: string;
    title: string;
    state: string;
    headRefName: string;
    baseRefName: string;
    additions: number;
    deletions: number;
    changedFiles: number;
  }>;

  return data.map(pr => ({
    number: pr.number,
    url: pr.url,
    title: pr.title,
    state: pr.state.toLowerCase() as PRInfo['state'],
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
  }));
}

/**
 * Add a comment to a pull request
 */
export async function commentOnPullRequest(
  workDir: string,
  prNumber: number,
  body: string
): Promise<void> {
  await execa('gh', ['pr', 'comment', prNumber.toString(), '--body', body], { cwd: workDir });
}

/**
 * Submit a review on a pull request
 */
export async function reviewPullRequest(
  workDir: string,
  prNumber: number,
  review: PRReview
): Promise<void> {
  const args = ['pr', 'review', prNumber.toString()];

  switch (review.state) {
    case 'APPROVED':
      args.push('--approve');
      break;
    case 'CHANGES_REQUESTED':
      args.push('--request-changes');
      break;
    case 'COMMENTED':
      args.push('--comment');
      break;
  }

  if (review.body) {
    args.push('--body', review.body);
  }

  await execa('gh', args, { cwd: workDir });
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(
  workDir: string,
  prNumber: number,
  options: {
    method?: 'merge' | 'squash' | 'rebase';
    deleteAfterMerge?: boolean;
  } = {}
): Promise<void> {
  const args = ['pr', 'merge', prNumber.toString(), '--auto'];

  switch (options.method) {
    case 'squash':
      args.push('--squash');
      break;
    case 'rebase':
      args.push('--rebase');
      break;
    default:
      args.push('--merge');
  }

  if (options.deleteAfterMerge !== false) {
    args.push('--delete-branch');
  }

  await execa('gh', args, { cwd: workDir });
}

/**
 * Close a pull request
 */
export async function closePullRequest(workDir: string, prNumber: number): Promise<void> {
  await execa('gh', ['pr', 'close', prNumber.toString()], { cwd: workDir });
}

/**
 * Get PR diff
 */
export async function getPullRequestDiff(workDir: string, prNumber: number): Promise<string> {
  const { stdout } = await execa('gh', ['pr', 'diff', prNumber.toString()], { cwd: workDir });

  return stdout;
}

/**
 * Get PR reviews
 */
export async function getPullRequestReviews(
  workDir: string,
  prNumber: number
): Promise<
  Array<{
    author: string;
    state: string;
    body: string;
  }>
> {
  const { stdout } = await execa('gh', ['pr', 'view', prNumber.toString(), '--json', 'reviews'], {
    cwd: workDir,
  });

  const data = JSON.parse(stdout);
  return data.reviews || [];
}
