// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execa } from 'execa';
import type { Database } from 'sql.js';
import { syncStatusForStory } from '../connectors/project-management/operations.js';
import { queryAll, withTransaction } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { createPullRequest } from '../db/queries/pull-requests.js';
import { updateStory } from '../db/queries/stories.js';
import { getAllTeams } from '../db/queries/teams.js';
import { extractStoryIdFromBranch } from './story-id.js';

const GITHUB_PR_LIST_LIMIT = 20;

/**
 * Extract 'owner/repo' slug from a GitHub URL for use with `gh -R`.
 * Handles https://github.com/owner/repo.git and similar variants.
 */
export function ghRepoSlug(repoUrl: string): string | null {
  const match = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  return match ? match[1] : null;
}

export interface GitHubPR {
  number: number;
  headRefName: string;
  url: string;
  title: string;
  createdAt: string; // ISO 8601 timestamp from GitHub
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

interface ExistingPRBranchRow {
  branch_name: string;
}

interface ExistingPRNumberRow {
  github_pr_number: number;
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
  const branchQuery = includeTerminalBranches
    ? 'SELECT branch_name FROM pull_requests'
    : "SELECT branch_name FROM pull_requests WHERE status NOT IN ('merged', 'closed')";
  const branchRows = queryAll<ExistingPRBranchRow>(db, branchQuery);
  const existingBranches = new Set(branchRows.map(row => row.branch_name));

  const numberRows = queryAll<ExistingPRNumberRow>(
    db,
    `
    SELECT DISTINCT github_pr_number
    FROM pull_requests
    WHERE github_pr_number IS NOT NULL
  `
  );
  const existingPrNumbers = new Set(numberRows.map(row => Number(row.github_pr_number)));

  return { existingBranches, existingPrNumbers };
}

/**
 * Fetch open GitHub PRs for a given repository directory.
 */
export async function fetchOpenGitHubPRs(
  repoDir: string,
  repoSlug?: string | null
): Promise<GitHubPR[]> {
  const args = [
    'pr',
    'list',
    '--json',
    'number,headRefName,url,title,createdAt',
    '--state',
    'open',
  ];
  if (repoSlug) args.push('-R', repoSlug);
  const result = await execa('gh', args, { cwd: repoDir });
  return JSON.parse(result.stdout) as GitHubPR[];
}

/**
 * Sync open GitHub PRs into the local merge queue.
 *
 * Core logic shared between `hive pr sync` CLI command and the manager daemon.
 *
 * Filters out old PRs that don't match active stories:
 * - PRs without story IDs are imported (for manual/hotfix PRs)
 * - PRs with story IDs are only imported if the story exists and is not merged
 * - PRs older than maxAgeHours are skipped (age-based filtering)
 *
 * @param db        - sql.js Database instance
 * @param repoDir   - Absolute path to the git repository
 * @param teamId    - Team ID to associate with created PRs (null for CLI usage)
 * @param existingBranches  - Set of branch names already in the queue
 * @param existingPrNumbers - Set of GitHub PR numbers already in the queue
 * @param repoSlug - Optional 'owner/repo' slug for `-R` flag (needed for forks)
 * @param maxAgeHours - Optional max age in hours for PRs (default: no limit)
 */
export async function syncOpenGitHubPRs(
  db: Database,
  repoDir: string,
  teamId: string | null,
  existingBranches: Set<string>,
  existingPrNumbers: Set<number>,
  repoSlug?: string | null,
  maxAgeHours?: number
): Promise<SyncGitHubPRsResult> {
  const ghPRs = await fetchOpenGitHubPRs(repoDir, repoSlug);
  const imported: SyncedPR[] = [];

  for (const ghPR of ghPRs) {
    if (existingBranches.has(ghPR.headRefName) || existingPrNumbers.has(ghPR.number)) {
      continue;
    }

    // Age-based filtering: skip PRs older than maxAgeHours
    if (maxAgeHours !== undefined) {
      const prCreatedAt = new Date(ghPR.createdAt);
      const ageHours = (Date.now() - prCreatedAt.getTime()) / (1000 * 60 * 60);

      if (ageHours > maxAgeHours) {
        createLog(db, {
          agentId: 'manager',
          eventType: 'PR_SYNC_SKIPPED',
          status: 'info',
          message: `Skipped syncing old PR #${ghPR.number} (${ghPR.headRefName}): created ${ageHours.toFixed(1)}h ago (max: ${maxAgeHours}h)`,
          metadata: {
            pr_number: ghPR.number,
            branch: ghPR.headRefName,
            age_hours: ageHours,
            max_age_hours: maxAgeHours,
            reason: 'too_old',
          },
        });
        continue;
      }
    }

    const storyId = extractStoryIdFromBranch(ghPR.headRefName);

    // If the PR has a story ID, check if the story is active
    if (storyId) {
      // Check if the story exists and is active (not merged)
      const storyRows = queryAll<{ id: string; status: string }>(
        db,
        `SELECT id, status FROM stories WHERE id = ? AND status != 'merged'`,
        [storyId]
      );

      // Skip PRs where story doesn't exist or is merged
      if (storyRows.length === 0) {
        createLog(db, {
          agentId: 'manager',
          eventType: 'PR_SYNC_SKIPPED',
          status: 'info',
          message: `Skipped syncing PR #${ghPR.number} (${ghPR.headRefName}): story ${storyId} not found or already merged`,
          metadata: {
            pr_number: ghPR.number,
            branch: ghPR.headRefName,
            story_id: storyId,
            reason: 'inactive_story',
          },
        });
        continue;
      }
    }

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

    // Keep the caller-provided identifier sets hot to avoid duplicate work
    // during multi-team sync runs that reuse these sets.
    existingBranches.add(ghPR.headRefName);
    existingPrNumbers.add(ghPR.number);
  }

  return { synced: imported.length, imported };
}

/**
 * Sync open GitHub PRs across all teams into the merge queue.
 * Convenience wrapper over syncOpenGitHubPRs for the common case of
 * syncing all teams at once.
 *
 * @param maxAgeHours - Optional max age in hours for PRs
 * @returns Total number of newly imported PRs.
 */
export async function syncAllTeamOpenPRs(
  root: string,
  db: Database,
  saveFn: () => void,
  maxAgeHours?: number
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
        existingPrNumbers,
        ghRepoSlug(team.repo_url),
        maxAgeHours
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
      const slug = ghRepoSlug(team.repo_url);
      const args = [
        'pr',
        'list',
        '--json',
        'number,headRefName,mergedAt',
        '--state',
        'merged',
        '--limit',
        String(GITHUB_PR_LIST_LIMIT),
      ];
      if (slug) args.push('-R', slug);
      const result = await execa('gh', args, { cwd: repoDir });
      const mergedPRs: Array<{ number: number; headRefName: string; mergedAt: string }> =
        JSON.parse(result.stdout);

      const candidateStoryIds = Array.from(
        new Set(
          mergedPRs
            .map(pr => extractStoryIdFromBranch(pr.headRefName))
            .filter((storyId): storyId is string => Boolean(storyId))
        )
      );

      if (candidateStoryIds.length === 0) {
        continue;
      }

      const placeholders = candidateStoryIds.map(() => '?').join(',');
      const updatableStories = queryAll<{ id: string }>(
        db,
        `
        SELECT id
        FROM stories
        WHERE status != 'merged'
        AND id IN (${placeholders})
      `,
        candidateStoryIds
      );
      const updatableStoryIds = new Set(updatableStories.map(story => story.id));
      const toUpdate: Array<{ storyId: string; prNumber: number }> = [];

      for (const pr of mergedPRs) {
        const storyId = extractStoryIdFromBranch(pr.headRefName);
        if (!storyId || !updatableStoryIds.has(storyId)) continue;

        updatableStoryIds.delete(storyId);
        toUpdate.push({ storyId, prNumber: pr.number });
      }

      if (toUpdate.length === 0) {
        continue;
      }

      await withTransaction(db, () => {
        for (const update of toUpdate) {
          updateStory(db, update.storyId, { status: 'merged', assignedAgentId: null });
          createLog(db, {
            agentId: 'manager',
            storyId: update.storyId,
            eventType: 'STORY_MERGED',
            message: `Story synced to merged from GitHub PR #${update.prNumber}`,
          });
        }
      }, saveFn);

      // Sync status changes to Jira (fire and forget, after DB commit)
      for (const update of toUpdate) {
        syncStatusForStory(root, db, update.storyId, 'merged');
      }

      storiesUpdated += toUpdate.length;
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
      continue;
    }
  }

  return storiesUpdated;
}

/**
 * Close stale GitHub PRs that are superseded by newer PRs for the same story.
 *
 * Scans open GitHub PRs and closes any that have a story ID with a newer PR
 * in the hive merge queue (i.e., the GitHub PR is stale/orphaned).
 *
 * @param root  - Root directory
 * @param db    - sql.js Database instance
 * @returns The number of stale PRs closed.
 */
export async function closeStaleGitHubPRs(root: string, db: Database): Promise<number> {
  const teams = getAllTeams(db);
  if (teams.length === 0) return 0;

  let prsClosed = 0;

  for (const team of teams) {
    if (!team.repo_path) continue;

    const repoDir = `${root}/${team.repo_path}`;

    try {
      // Fetch open GitHub PRs
      const openGHPRs = await fetchOpenGitHubPRs(repoDir);

      for (const ghPR of openGHPRs) {
        const storyId = extractStoryIdFromBranch(ghPR.headRefName);
        if (!storyId) continue;

        // Check if there are other PRs for this story in the queue
        const prsForStory = queryAll<{ id: string; github_pr_number: number | null }>(
          db,
          `
          SELECT id, github_pr_number
          FROM pull_requests
          WHERE story_id = ?
          AND status NOT IN ('closed')
          ORDER BY created_at DESC
        `,
          [storyId]
        );

        // If there are PRs in the queue for this story, check if this GitHub PR is stale
        if (prsForStory.length > 0) {
          // Check if this GitHub PR number matches any of the queue PRs
          const isInQueue = prsForStory.some(pr => pr.github_pr_number === ghPR.number);

          // If this PR is not in the queue, it's stale and should be closed
          if (!isInQueue) {
            try {
              await execa('gh', ['pr', 'close', String(ghPR.number)], { cwd: repoDir });
              createLog(db, {
                agentId: 'manager',
                storyId,
                eventType: 'PR_CLOSED',
                message: `Auto-closed stale GitHub PR #${ghPR.number} (${ghPR.headRefName}) - superseded by newer PR`,
                metadata: {
                  github_pr_number: ghPR.number,
                  branch: ghPR.headRefName,
                  reason: 'stale',
                },
              });
              prsClosed++;
            } catch {
              // Non-fatal - PR might already be closed or gh CLI issue
            }
          }
        }
      }
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
      continue;
    }
  }

  return prsClosed;
}
