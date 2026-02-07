import { execa } from 'execa';
import type { Database } from 'sql.js';
import { queryAll, type PullRequestRow } from '../db/client.js';
import { createPullRequest } from '../db/queries/pull-requests.js';
import { extractStoryIdFromBranch } from './story-id.js';

export interface GitHubPR {
  number: number;
  headRefName: string;
  url: string;
  title: string;
}

export interface SyncedPR {
  number: number;
  branch: string;
  prId: string;
}

export interface SyncGitHubPRsResult {
  synced: number;
  imported: SyncedPR[];
}

/**
 * Build sets of existing branch names and PR numbers from the database.
 *
 * @param db - sql.js Database instance
 * @param includeTerminalBranches - If true, include merged/closed PR branches
 *   in the returned set (prevents re-importing previously synced PRs).
 *   Defaults to true.
 */
export function getExistingPRIdentifiers(
  db: Database,
  includeTerminalBranches = true
): { existingBranches: Set<string>; existingPrNumbers: Set<number> } {
  const existingPRs = queryAll<PullRequestRow>(db, 'SELECT * FROM pull_requests');

  const existingBranches = new Set(
    includeTerminalBranches
      ? existingPRs.map(pr => pr.branch_name)
      : existingPRs
          .filter(pr => !['merged', 'closed'].includes(pr.status))
          .map(pr => pr.branch_name)
  );

  const existingPrNumbers = new Set(
    existingPRs.map(pr => pr.github_pr_number).filter((n): n is number => n != null)
  );

  return { existingBranches, existingPrNumbers };
}

/**
 * Fetch open GitHub PRs for a given repository directory.
 */
export async function fetchOpenGitHubPRs(repoDir: string): Promise<GitHubPR[]> {
  const result = await execa(
    'gh',
    ['pr', 'list', '--json', 'number,headRefName,url,title', '--state', 'open'],
    { cwd: repoDir }
  );
  return JSON.parse(result.stdout) as GitHubPR[];
}

/**
 * Sync open GitHub PRs into the local merge queue.
 *
 * Core logic shared between `hive pr sync` CLI command and the manager daemon.
 *
 * @param db        - sql.js Database instance
 * @param repoDir   - Absolute path to the git repository
 * @param teamId    - Team ID to associate with created PRs (null for CLI usage)
 * @param existingBranches  - Set of branch names already in the queue
 * @param existingPrNumbers - Set of GitHub PR numbers already in the queue
 */
export async function syncOpenGitHubPRs(
  db: Database,
  repoDir: string,
  teamId: string | null,
  existingBranches: Set<string>,
  existingPrNumbers: Set<number>
): Promise<SyncGitHubPRsResult> {
  const ghPRs = await fetchOpenGitHubPRs(repoDir);
  const imported: SyncedPR[] = [];

  for (const ghPR of ghPRs) {
    if (existingBranches.has(ghPR.headRefName) || existingPrNumbers.has(ghPR.number)) {
      continue;
    }

    const storyId = extractStoryIdFromBranch(ghPR.headRefName);

    const pr = createPullRequest(db, {
      storyId,
      teamId,
      branchName: ghPR.headRefName,
      githubPrNumber: ghPR.number,
      githubPrUrl: ghPR.url,
      submittedBy: null,
    });

    imported.push({
      number: ghPR.number,
      branch: ghPR.headRefName,
      prId: pr.id,
    });
  }

  return { synced: imported.length, imported };
}
