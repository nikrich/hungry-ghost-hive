// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import { loadConfig } from '../config/loader.js';
import {
  postLifecycleComment,
  syncStatusForStory,
} from '../connectors/project-management/operations.js';
import type { DatabaseClient } from '../db/client.js';
import { queryOne, withTransaction } from '../db/client.js';
import { getAgentById, updateAgent } from '../db/queries/agents.js';
import { createLog } from '../db/queries/logs.js';
import {
  getApprovedPullRequests,
  updatePullRequest,
  type PullRequestRow,
} from '../db/queries/pull-requests.js';
import { getStoryById, updateStory } from '../db/queries/stories.js';
import { getAllTeams } from '../db/queries/teams.js';
import { isManualMergeRequired } from './manual-merge.js';
import { getHivePaths } from './paths.js';
import { ghRepoSlug } from './pr-sync.js';

/** Timeout in ms for checking PR state via GitHub API */
const PR_STATE_CHECK_TIMEOUT_MS = 30000;
/** Timeout in ms for GitHub merge operations */
const PR_MERGE_TIMEOUT_MS = 60000;

interface GitHubPRState {
  state: string;
  mergeable: string;
}

/**
 * Callback type for executing a function with the DB lock held.
 * The lock is acquired before calling fn and released after it returns.
 * This enables releasing the lock between phases of auto-merge.
 */
export type WithLockFn = <T>(fn: (db: DatabaseClient) => Promise<T>) => Promise<T>;

/** Collected info needed to execute GitHub operations without holding the lock */
interface ClaimedPR {
  pr: PullRequestRow;
  repoCwd: string;
  repoFlag: string;
  teamId: string | null;
}

/**
 * Auto-merge all approved PRs that are ready to merge.
 * Can be called immediately after PR approval or from manager daemon.
 *
 * When `withLock` is provided, the function releases the DB lock during
 * GitHub API calls (Phase 2) and re-acquires it for DB updates (Phase 3).
 * This prevents holding the lock for 30-60+ seconds during network operations.
 *
 * @param root - Hive root directory
 * @param db - Database client (used directly when withLock is not provided)
 * @param withLock - Optional lock-acquire function for phased lock management.
 *   When provided, db updates use withLock; when omitted, uses db directly (legacy behavior).
 * @returns Number of PRs successfully merged
 */
export async function autoMergeApprovedPRs(
  root: string,
  db: DatabaseClient | null,
  withLock?: WithLockFn
): Promise<number> {
  // Load config to check autonomy level
  const paths = getHivePaths(root);
  const config = loadConfig(paths.hiveDir);

  // Skip auto-merge in partial autonomy mode
  if (config.integrations.autonomy.level === 'partial') {
    return 0;
  }

  // === Phase 1 (with lock): Read approved PRs and claim them ===
  const claimedPRs: ClaimedPR[] = [];

  const claimPhase = async (phaseDb: DatabaseClient) => {
    const approvedPRs = getApprovedPullRequests(phaseDb.db).filter(
      pr => !isManualMergeRequired(pr.review_notes)
    );

    for (const pr of approvedPRs) {
      if (!pr.github_pr_number) continue;

      let claimed = false;
      await withTransaction(
        phaseDb.db,
        () => {
          const currentPR = queryOne<{ status: string }>(
            phaseDb.db,
            `SELECT status FROM pull_requests WHERE id = ?`,
            [pr.id]
          );
          if (currentPR?.status === 'approved') {
            updatePullRequest(phaseDb.db, pr.id, { status: 'queued' });
            claimed = true;
          }
        },
        () => phaseDb.save()
      );

      if (!claimed) continue;

      // Resolve team/repo info while we have the lock
      let teamId = pr.team_id;
      let repoCwd = root;
      let repoSlug: string | null = null;

      if (teamId) {
        const team = getAllTeams(phaseDb.db).find(t => t.id === teamId);
        if (team?.repo_path) repoCwd = join(root, team.repo_path);
        if (team?.repo_url) repoSlug = ghRepoSlug(team.repo_url);
      } else if (pr.branch_name) {
        const teams = getAllTeams(phaseDb.db);
        for (const team of teams) {
          if (team.repo_path) {
            repoCwd = join(root, team.repo_path);
            teamId = team.id;
            if (team.repo_url) repoSlug = ghRepoSlug(team.repo_url);
            break;
          }
        }
      }

      claimedPRs.push({
        pr,
        repoCwd,
        repoFlag: repoSlug ? ` -R ${repoSlug}` : '',
        teamId,
      });
    }
  };

  if (withLock) {
    await withLock(claimPhase);
  } else if (db) {
    await claimPhase(db);
  } else {
    throw new Error('autoMergeApprovedPRs: either db or withLock must be provided');
  }

  if (claimedPRs.length === 0) return 0;

  // === Phase 2 (WITHOUT lock): Execute GitHub API calls ===
  interface MergeResult {
    claimed: ClaimedPR;
    outcome:
      | { type: 'merged' }
      | { type: 'already_closed'; prState: GitHubPRState }
      | { type: 'conflicts' }
      | { type: 'unknown_state' }
      | { type: 'merge_failed'; error: Error };
  }

  const results: MergeResult[] = [];
  const { execSync } = await import('child_process');

  for (const claimed of claimedPRs) {
    const { pr, repoCwd, repoFlag } = claimed;
    try {
      // Check PR state
      let prState: GitHubPRState;
      let mergeableStatus: boolean;
      try {
        const prViewOutput = execSync(
          `gh pr view ${pr.github_pr_number} --json state,mergeable${repoFlag}`,
          {
            stdio: 'pipe',
            cwd: repoCwd,
            encoding: 'utf-8',
            timeout: PR_STATE_CHECK_TIMEOUT_MS,
          }
        );
        prState = JSON.parse(prViewOutput);
        mergeableStatus = prState.mergeable === 'MERGEABLE';
      } catch {
        results.push({ claimed, outcome: { type: 'unknown_state' } });
        continue;
      }

      if (prState.state !== 'OPEN') {
        results.push({ claimed, outcome: { type: 'already_closed', prState } });
        continue;
      }

      if (!mergeableStatus) {
        results.push({ claimed, outcome: { type: 'conflicts' } });
        continue;
      }

      // Attempt merge
      try {
        execSync(`gh pr merge ${pr.github_pr_number} --auto --squash --delete-branch${repoFlag}`, {
          stdio: 'pipe',
          cwd: repoCwd,
          timeout: PR_MERGE_TIMEOUT_MS,
        });
        results.push({ claimed, outcome: { type: 'merged' } });
      } catch (mergeErr) {
        results.push({
          claimed,
          outcome: {
            type: 'merge_failed',
            error: mergeErr instanceof Error ? mergeErr : new Error(String(mergeErr)),
          },
        });
      }
    } catch {
      // Non-fatal - skip this PR
      continue;
    }
  }

  // === Phase 3 (with lock): Update DB with results ===
  let mergedCount = 0;

  const updatePhase = async (phaseDb: DatabaseClient) => {
    for (const result of results) {
      const { pr } = result.claimed;

      switch (result.outcome.type) {
        case 'unknown_state': {
          createLog(phaseDb.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): Could not determine PR status`,
            metadata: { pr_id: pr.id },
          });
          break;
        }

        case 'already_closed': {
          const prState = result.outcome.prState;
          const newStatus = prState.state === 'MERGED' ? 'merged' : 'closed';
          await withTransaction(
            phaseDb.db,
            () => {
              updatePullRequest(phaseDb.db, pr.id, { status: newStatus });
              if (pr.story_id && prState.state === 'MERGED') {
                const story = getStoryById(phaseDb.db, pr.story_id);
                if (story?.assigned_agent_id) {
                  const agent = getAgentById(phaseDb.db, story.assigned_agent_id);
                  if (agent && agent.current_story_id === pr.story_id) {
                    updateAgent(phaseDb.db, agent.id, { currentStoryId: null, status: 'idle' });
                  }
                }
                updateStory(phaseDb.db, pr.story_id, { status: 'merged', assignedAgentId: null });
                createLog(phaseDb.db, {
                  agentId: 'manager',
                  storyId: pr.story_id,
                  eventType: 'STORY_MERGED',
                  message: `Story merged (PR #${pr.github_pr_number} was already merged on GitHub)`,
                  metadata: { pr_id: pr.id },
                });
                postLifecycleComment(
                  phaseDb.db,
                  paths.hiveDir,
                  config,
                  pr.story_id,
                  'merged'
                ).catch(() => {
                  /* non-fatal */
                });
              }
              createLog(phaseDb.db, {
                agentId: 'manager',
                storyId: pr.story_id || undefined,
                eventType: 'PR_MERGE_SKIPPED',
                message: `PR #${pr.github_pr_number} is already ${prState.state.toLowerCase()}, skipping merge`,
                metadata: { pr_id: pr.id, github_state: prState.state },
              });
            },
            () => phaseDb.save()
          );

          if (pr.story_id && prState.state === 'MERGED') {
            syncStatusForStory(root, phaseDb.db, pr.story_id, 'merged');
          }
          break;
        }

        case 'conflicts': {
          createLog(phaseDb.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): PR has merge conflicts`,
            metadata: { pr_id: pr.id },
          });
          break;
        }

        case 'merged': {
          const storyId = pr.story_id;
          await withTransaction(
            phaseDb.db,
            () => {
              updatePullRequest(phaseDb.db, pr.id, { status: 'merged' });
              if (storyId) {
                updateStory(phaseDb.db, storyId, { status: 'merged' });
                const story = getStoryById(phaseDb.db, storyId);
                if (story?.assigned_agent_id) {
                  const agent = getAgentById(phaseDb.db, story.assigned_agent_id);
                  if (agent && agent.current_story_id === storyId) {
                    updateAgent(phaseDb.db, agent.id, { currentStoryId: null, status: 'idle' });
                  }
                }
                createLog(phaseDb.db, {
                  agentId: 'manager',
                  storyId,
                  eventType: 'STORY_MERGED',
                  message: `Story auto-merged from GitHub PR #${pr.github_pr_number}`,
                });
              } else {
                createLog(phaseDb.db, {
                  agentId: 'manager',
                  eventType: 'PR_MERGED',
                  message: `PR ${pr.id} auto-merged (GitHub PR #${pr.github_pr_number})`,
                  metadata: { pr_id: pr.id },
                });
              }
            },
            () => phaseDb.save()
          );

          mergedCount++;

          if (storyId) {
            postLifecycleComment(phaseDb.db, paths.hiveDir, config, storyId, 'merged').catch(() => {
              /* non-fatal */
            });
            syncStatusForStory(root, phaseDb.db, storyId, 'merged');
          }
          break;
        }

        case 'merge_failed': {
          await withTransaction(
            phaseDb.db,
            () => {
              updatePullRequest(phaseDb.db, pr.id, { status: 'approved' });
              createLog(phaseDb.db, {
                agentId: 'manager',
                storyId: pr.story_id || undefined,
                eventType: 'PR_MERGE_FAILED',
                status: 'error',
                message: `Failed to auto-merge PR ${pr.id} (GitHub PR #${pr.github_pr_number}): ${result.outcome.type === 'merge_failed' ? result.outcome.error.message : 'Unknown error'}`,
                metadata: { pr_id: pr.id },
              });
            },
            () => phaseDb.save()
          );
          break;
        }
      }
    }
  };

  if (withLock) {
    await withLock(updatePhase);
  } else if (db) {
    await updatePhase(db);
  } else {
    throw new Error('autoMergeApprovedPRs: either db or withLock must be provided');
  }

  return mergedCount;
}
