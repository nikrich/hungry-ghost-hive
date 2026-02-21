// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { execa } from 'execa';
import type { Database } from 'sql.js';
import { syncStatusForStory } from '../connectors/project-management/operations.js';
import { queryAll, withTransaction } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { createPullRequest, updatePullRequest } from '../db/queries/pull-requests.js';
import { updateStory } from '../db/queries/stories.js';
import { getAllTeams } from '../db/queries/teams.js';
import { extractPRNumber } from './github.js';
import { extractStoryIdFromBranch } from './story-id.js';

const GITHUB_PR_LIST_LIMIT = 20;
const GITHUB_PR_URL_REGEX = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i;

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

interface UnlinkedQueuePRRow {
  id: string;
  team_id: string | null;
  story_id: string | null;
  branch_name: string;
}

export interface QueueGitHubPRLinkFailure {
  prId: string;
  branch: string;
  reason: string;
}

export interface EnsureQueueGitHubPRLinksResult {
  linked: number;
  autoClosedNoDiff: number;
  failed: QueueGitHubPRLinkFailure[];
}

function extractGitHubPrUrl(text: string): string | null {
  const match = text.match(GITHUB_PR_URL_REGEX);
  return match ? match[0] : null;
}

function getCommandOutput(error: unknown): string {
  if (!(typeof error === 'object' && error !== null)) {
    return String(error);
  }

  const parts: string[] = [];
  const commandError = error as {
    shortMessage?: unknown;
    message?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };

  if (typeof commandError.shortMessage === 'string') parts.push(commandError.shortMessage);
  if (typeof commandError.message === 'string') parts.push(commandError.message);
  if (typeof commandError.stdout === 'string') parts.push(commandError.stdout);
  if (typeof commandError.stderr === 'string') parts.push(commandError.stderr);

  return parts.join('\n').trim();
}

async function getDefaultBaseBranch(repoDir: string): Promise<string | null> {
  try {
    const result = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
      cwd: repoDir,
    });
    const remoteRef = result.stdout.trim();
    const parts = remoteRef.split('/');
    const base = parts[parts.length - 1];
    return base || null;
  } catch {
    return null;
  }
}

async function getExistingGitHubPrForBranch(
  repoDir: string,
  branch: string
): Promise<{ number: number | null; url: string | null } | null> {
  try {
    const result = await execa('gh', ['pr', 'view', branch, '--json', 'number,url'], { cwd: repoDir });
    const parsed = JSON.parse(result.stdout) as { number?: number; url?: string };
    if (!parsed.url) return null;
    return {
      number: typeof parsed.number === 'number' ? parsed.number : extractPRNumber(parsed.url) || null,
      url: parsed.url,
    };
  } catch {
    return null;
  }
}

async function createOrFindGitHubPr(
  repoDir: string,
  branch: string
): Promise<{ number: number | null; url: string | null }> {
  const baseBranch = await getDefaultBaseBranch(repoDir);
  const createArgs = ['pr', 'create', '--head', branch, '--fill'];
  if (baseBranch) {
    createArgs.push('--base', baseBranch);
  }

  try {
    const result = await execa('gh', createArgs, { cwd: repoDir });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const prUrl = extractGitHubPrUrl(output);
    if (!prUrl) {
      const existingPr = await getExistingGitHubPrForBranch(repoDir, branch);
      if (existingPr) return existingPr;
      throw new Error('gh pr create completed but no PR URL could be determined');
    }
    return { number: extractPRNumber(prUrl) || null, url: prUrl };
  } catch (error) {
    const output = getCommandOutput(error);
    const prUrl = extractGitHubPrUrl(output);
    if (prUrl) {
      return { number: extractPRNumber(prUrl) || null, url: prUrl };
    }

    if (
      /already exists|already has an open pull request|already open/i.test(output) ||
      /a pull request for branch .* already exists/i.test(output)
    ) {
      const existingPr = await getExistingGitHubPrForBranch(repoDir, branch);
      if (existingPr) return existingPr;
    }

    throw new Error(output || 'Unknown gh pr create error');
  }
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
  const args = ['pr', 'list', '--json', 'number,headRefName,url,title', '--state', 'open'];
  if (repoSlug) args.push('-R', repoSlug);
  const result = await execa('gh', args, { cwd: repoDir });
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
 * @param repoSlug - Optional 'owner/repo' slug for `-R` flag (needed for forks)
 */
export async function syncOpenGitHubPRs(
  db: Database,
  repoDir: string,
  teamId: string | null,
  existingBranches: Set<string>,
  existingPrNumbers: Set<number>,
  repoSlug?: string | null
): Promise<SyncGitHubPRsResult> {
  const ghPRs = await fetchOpenGitHubPRs(repoDir, repoSlug);
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
        existingPrNumbers,
        ghRepoSlug(team.repo_url)
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
 * Ensure queued/reviewing/approved PR rows are linked to a real GitHub PR.
 * Useful for recovering from local-only queue submissions.
 */
export async function ensureQueueGitHubPRLinks(
  root: string,
  db: Database
): Promise<EnsureQueueGitHubPRLinksResult> {
  const unlinkedPRs = queryAll<UnlinkedQueuePRRow>(
    db,
    `
    SELECT id, team_id, story_id, branch_name
    FROM pull_requests
    WHERE status IN ('queued', 'reviewing', 'approved')
      AND github_pr_number IS NULL
      AND github_pr_url IS NULL
    ORDER BY created_at ASC
  `
  );

  if (unlinkedPRs.length === 0) {
    return { linked: 0, autoClosedNoDiff: 0, failed: [] };
  }

  const teamRepoById = new Map<string, string>();
  const teams = getAllTeams(db);
  for (const team of teams) {
    if (team.id && team.repo_path) {
      teamRepoById.set(team.id, `${root}/${team.repo_path}`);
    }
  }

  const failed: QueueGitHubPRLinkFailure[] = [];
  let linked = 0;
  let autoClosedNoDiff = 0;

  for (const pr of unlinkedPRs) {
    const repoDir = pr.team_id ? (teamRepoById.get(pr.team_id) ?? root) : root;

    try {
      const linkedPr = await createOrFindGitHubPr(repoDir, pr.branch_name);
      let githubPrNumber = linkedPr.number;
      const githubPrUrl = linkedPr.url;

      if (!githubPrNumber && githubPrUrl) {
        githubPrNumber = extractPRNumber(githubPrUrl) || null;
      }

      if (!githubPrNumber && !githubPrUrl) {
        throw new Error('No GitHub PR metadata returned');
      }

      updatePullRequest(db, pr.id, {
        githubPrNumber,
        githubPrUrl,
      });

      createLog(db, {
        agentId: 'manager',
        storyId: undefined,
        eventType: 'PR_LINKED',
        message: `Linked queue PR ${pr.id} (${pr.branch_name}) to GitHub`,
        metadata: {
          pr_id: pr.id,
          branch: pr.branch_name,
          github_pr_number: githubPrNumber,
          github_pr_url: githubPrUrl,
        },
      });
      linked++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (/could not find any commits between/i.test(reason)) {
        updatePullRequest(db, pr.id, {
          status: 'closed',
          reviewNotes:
            '[auto-closed:no-commits] Branch has no commits ahead of origin/main; story returned to in_progress',
        });
        if (pr.story_id) {
          updateStory(db, pr.story_id, { status: 'in_progress' });
        }
        createLog(db, {
          agentId: 'manager',
          storyId: pr.story_id || undefined,
          eventType: 'PR_CLOSED',
          message: `Auto-closed queue PR ${pr.id} (${pr.branch_name}): no commits ahead of origin/main`,
          metadata: {
            pr_id: pr.id,
            story_id: pr.story_id,
            branch: pr.branch_name,
            reason: 'no_commits_ahead',
          },
        });
        autoClosedNoDiff++;
        continue;
      }

      failed.push({
        prId: pr.id,
        branch: pr.branch_name,
        reason,
      });
      createLog(db, {
        agentId: 'manager',
        storyId: undefined,
        eventType: 'PR_LINK_FAILED',
        message: `Failed linking queue PR ${pr.id} (${pr.branch_name}) to GitHub: ${reason}`,
        metadata: {
          pr_id: pr.id,
          branch: pr.branch_name,
          reason,
        },
      });
    }
  }

  return { linked, autoClosedNoDiff, failed };
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
      });

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

  if (storiesUpdated > 0) {
    saveFn();
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
