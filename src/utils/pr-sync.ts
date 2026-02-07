import { execa } from 'execa';
import type { Database } from 'sql.js';
import { queryAll, withTransaction, type PullRequestRow } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { createPullRequest, updatePullRequest } from '../db/queries/pull-requests.js';
import { updateStory } from '../db/queries/stories.js';
import { getAllTeams } from '../db/queries/teams.js';
import { extractStoryIdFromBranch } from './story-id.js';

const GITHUB_PR_LIST_LIMIT = 50;

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

/**
 * Sync open GitHub PRs across all teams into the merge queue.
 * Convenience wrapper over syncOpenGitHubPRs for the common case of
 * syncing all teams at once.
 *
 * @returns Total number of newly imported PRs.
 */
export async function syncAllTeamOpenPRs(
  root: string,
  db: Database,
  saveFn: () => void
): Promise<number> {
  const teams = getAllTeams(db);
  if (teams.length === 0) return 0;

  const { existingBranches, existingPrNumbers } = getExistingPRIdentifiers(db, true);
  let totalSynced = 0;

  for (const team of teams) {
    if (!team.repo_path) continue;
    const repoDir = `${root}/${team.repo_path}`;
    try {
      const result = await syncOpenGitHubPRs(
        db,
        repoDir,
        team.id,
        existingBranches,
        existingPrNumbers
      );
      totalSynced += result.synced;
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
    }
  }

  if (totalSynced > 0) {
    saveFn();
  }

  return totalSynced;
}

/**
 * Sync recently merged PRs from GitHub and update story statuses accordingly.
 *
 * @returns The number of stories updated to 'merged'.
 */
export async function syncMergedPRsFromGitHub(
  root: string,
  db: Database,
  saveFn: () => void
): Promise<number> {
  const teams = getAllTeams(db);
  if (teams.length === 0) return 0;

  let storiesUpdated = 0;

  for (const team of teams) {
    if (!team.repo_path) continue;

    const repoDir = `${root}/${team.repo_path}`;

    try {
      const result = await execa(
        'gh',
        [
          'pr',
          'list',
          '--json',
          'number,headRefName,mergedAt',
          '--state',
          'merged',
          '--limit',
          String(GITHUB_PR_LIST_LIMIT),
        ],
        { cwd: repoDir }
      );
      const mergedPRs: Array<{ number: number; headRefName: string; mergedAt: string }> =
        JSON.parse(result.stdout);

      for (const pr of mergedPRs) {
        const storyId = extractStoryIdFromBranch(pr.headRefName);
        if (!storyId) continue;

        const story = queryAll(db, "SELECT * FROM stories WHERE id = ? AND status != 'merged'", [
          storyId,
        ]);

        if (story.length > 0) {
          await withTransaction(db, () => {
            updateStory(db, storyId, { status: 'merged', assignedAgentId: null });

            createLog(db, {
              agentId: 'manager',
              storyId,
              eventType: 'STORY_MERGED',
              message: `Story synced to merged from GitHub PR #${pr.number}`,
            });
          });

          storiesUpdated++;
        }
      }
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
      continue;
    }
  }

  if (storiesUpdated > 0) {
    saveFn();
  }

  return storiesUpdated;
}

/**
 * Sync recently closed (but not merged) PRs from GitHub and update PR statuses accordingly.
 * This prevents auto-merge from retrying forever on PRs that were closed/rejected on GitHub.
 *
 * @returns The number of PRs updated to 'closed'.
 */
export async function syncClosedPRsFromGitHub(
  root: string,
  db: Database,
  saveFn: () => void
): Promise<number> {
  const teams = getAllTeams(db);
  if (teams.length === 0) return 0;

  let prsUpdated = 0;

  for (const team of teams) {
    if (!team.repo_path) continue;

    const repoDir = `${root}/${team.repo_path}`;

    try {
      const result = await execa(
        'gh',
        [
          'pr',
          'list',
          '--json',
          'number,headRefName,closedAt',
          '--state',
          'closed',
          '--limit',
          String(GITHUB_PR_LIST_LIMIT),
        ],
        { cwd: repoDir }
      );
      const closedPRs: Array<{ number: number; headRefName: string; closedAt: string }> =
        JSON.parse(result.stdout);

      for (const pr of closedPRs) {
        // Find matching PR in local DB that isn't already closed
        const localPRs = queryAll<PullRequestRow>(
          db,
          "SELECT * FROM pull_requests WHERE branch_name = ? AND status NOT IN ('closed', 'merged')",
          [pr.headRefName]
        );

        if (localPRs.length > 0) {
          const localPR = localPRs[0];

          await withTransaction(db, () => {
            updatePullRequest(db, localPR.id, { status: 'closed' });

            createLog(db, {
              agentId: 'manager',
              storyId: localPR.story_id || undefined,
              eventType: 'PR_CLOSED',
              message: `PR #${pr.number} synced to closed from GitHub (branch: ${pr.headRefName})`,
            });
          });

          prsUpdated++;
        }
      }
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
      continue;
    }
  }

  if (prsUpdated > 0) {
    saveFn();
  }

  return prsUpdated;
}
