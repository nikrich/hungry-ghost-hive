// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import { loadConfig } from '../config/loader.js';
import {
  postLifecycleComment,
  syncStatusForStory,
} from '../connectors/project-management/operations.js';
import type { DatabaseClient } from '../db/client.js';
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
  mergeStateStatus: string;
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
  repoSlug: string | null;
  teamId: string | null;
}

/**
 * Compare CI check failures between a PR and its base branch.
 * Returns bypassed=true when every failing check on the PR also fails on the base branch.
 */
export function checkPreexistingCIFailures(
  prNumber: number,
  repoCwd: string,
  repoFlag: string,
  repoSlug: string | null,
  execSyncFn: typeof import('child_process').execSync
): { bypassed: boolean; bypassedChecks: string[] } {
  try {
    // Get failing checks on the PR
    const prChecksRaw = execSyncFn(`gh pr checks ${prNumber} --json name,state${repoFlag}`, {
      stdio: 'pipe',
      cwd: repoCwd,
      encoding: 'utf-8',
      timeout: PR_STATE_CHECK_TIMEOUT_MS,
    }) as string;
    const prChecks: Array<{ name: string; state: string }> = JSON.parse(prChecksRaw);
    const prFailingNames = new Set(prChecks.filter(c => c.state === 'FAIL').map(c => c.name));

    if (prFailingNames.size === 0) return { bypassed: false, bypassedChecks: [] };

    // Get the base branch ref
    const baseRefRaw = execSyncFn(`gh pr view ${prNumber} --json baseRefName${repoFlag}`, {
      stdio: 'pipe',
      cwd: repoCwd,
      encoding: 'utf-8',
      timeout: PR_STATE_CHECK_TIMEOUT_MS,
    }) as string;
    const { baseRefName } = JSON.parse(baseRefRaw);

    // Determine repo slug for API call
    let slug = repoSlug;
    if (!slug) {
      try {
        slug = (
          execSyncFn('gh repo view --json nameWithOwner -q .nameWithOwner', {
            stdio: 'pipe',
            cwd: repoCwd,
            encoding: 'utf-8',
            timeout: PR_STATE_CHECK_TIMEOUT_MS,
          }) as string
        ).trim();
      } catch {
        return { bypassed: false, bypassedChecks: [] };
      }
    }

    // Get check runs on the base branch
    const baseChecksRaw = execSyncFn(
      `gh api repos/${slug}/commits/${baseRefName}/check-runs --jq '.check_runs'`,
      { stdio: 'pipe', cwd: repoCwd, encoding: 'utf-8', timeout: PR_STATE_CHECK_TIMEOUT_MS }
    ) as string;
    const baseCheckRuns: Array<{ name: string; conclusion: string }> = JSON.parse(baseChecksRaw);
    const baseFailingNames = new Set(
      baseCheckRuns.filter(c => c.conclusion === 'failure').map(c => c.name)
    );

    // Check if all PR failures also fail on base
    const prOnlyFailures = [...prFailingNames].filter(name => !baseFailingNames.has(name));

    if (prOnlyFailures.length === 0) {
      return { bypassed: true, bypassedChecks: [...prFailingNames] };
    }

    return { bypassed: false, bypassedChecks: [] };
  } catch {
    return { bypassed: false, bypassedChecks: [] };
  }
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
    const approvedPRs = (await getApprovedPullRequests(phaseDb.provider)).filter(
      pr => !isManualMergeRequired(pr.review_notes)
    );

    for (const pr of approvedPRs) {
      if (!pr.github_pr_number) continue;

      let claimed = false;
      await phaseDb.provider.withTransaction(async () => {
        const currentPR = await phaseDb.provider.queryOne<{ status: string }>(
          `SELECT status FROM pull_requests WHERE id = ?`,
          [pr.id]
        );
        if (currentPR?.status === 'approved') {
          await updatePullRequest(phaseDb.provider, pr.id, { status: 'queued' });
          claimed = true;
        }
      });
      phaseDb.save();

      if (!claimed) continue;

      // Resolve team/repo info while we have the lock
      let teamId = pr.team_id;
      let repoCwd = root;
      let repoSlug: string | null = null;

      if (teamId) {
        const team = (await getAllTeams(phaseDb.provider)).find(t => t.id === teamId);
        if (team?.repo_path) repoCwd = join(root, team.repo_path);
        if (team?.repo_url) repoSlug = ghRepoSlug(team.repo_url);
      } else if (pr.branch_name) {
        const teams = await getAllTeams(phaseDb.provider);
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
        repoSlug,
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
      | { type: 'auto_merge_pending' }
      | { type: 'branch_updated' }
      | { type: 'already_closed'; prState: GitHubPRState }
      | { type: 'conflicts' }
      | { type: 'ci_blocked' }
      | { type: 'ci_bypassed'; bypassedChecks: string[] }
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
      try {
        const prViewOutput = execSync(
          `gh pr view ${pr.github_pr_number} --json state,mergeable,mergeStateStatus${repoFlag}`,
          {
            stdio: 'pipe',
            cwd: repoCwd,
            encoding: 'utf-8',
            timeout: PR_STATE_CHECK_TIMEOUT_MS,
          }
        );
        prState = JSON.parse(prViewOutput);
      } catch {
        results.push({ claimed, outcome: { type: 'unknown_state' } });
        continue;
      }

      if (prState.state !== 'OPEN') {
        results.push({ claimed, outcome: { type: 'already_closed', prState } });
        continue;
      }

      // Update stale branches that are behind the base branch
      if (prState.mergeStateStatus === 'BEHIND') {
        try {
          execSync(`gh pr update-branch ${pr.github_pr_number}${repoFlag}`, {
            stdio: 'pipe',
            cwd: repoCwd,
            timeout: PR_MERGE_TIMEOUT_MS,
          });
          results.push({ claimed, outcome: { type: 'branch_updated' } });
        } catch {
          results.push({ claimed, outcome: { type: 'unknown_state' } });
        }
        continue;
      }

      if (prState.mergeable !== 'MERGEABLE') {
        results.push({ claimed, outcome: { type: 'conflicts' } });
        continue;
      }

      // Handle BLOCKED mergeStateStatus (CI checks failing)
      if (prState.mergeStateStatus === 'BLOCKED') {
        if (config.integrations.autonomy.allow_preexisting_ci_failures) {
          const ciResult = checkPreexistingCIFailures(
            pr.github_pr_number!,
            repoCwd,
            repoFlag,
            claimed.repoSlug,
            execSync
          );
          if (ciResult.bypassed) {
            // All CI failures also exist on the base branch — attempt merge with admin bypass
            try {
              execSync(
                `gh pr merge ${pr.github_pr_number} --squash --delete-branch --admin${repoFlag}`,
                { stdio: 'pipe', cwd: repoCwd, timeout: PR_MERGE_TIMEOUT_MS }
              );
              results.push({
                claimed,
                outcome: { type: 'ci_bypassed', bypassedChecks: ciResult.bypassedChecks },
              });
            } catch (mergeErr) {
              results.push({
                claimed,
                outcome: {
                  type: 'merge_failed',
                  error: mergeErr instanceof Error ? mergeErr : new Error(String(mergeErr)),
                },
              });
            }
            continue;
          }
        }
        // New CI failures or config disabled — skip
        results.push({ claimed, outcome: { type: 'ci_blocked' } });
        continue;
      }

      // Attempt merge
      try {
        execSync(`gh pr merge ${pr.github_pr_number} --auto --squash --delete-branch${repoFlag}`, {
          stdio: 'pipe',
          cwd: repoCwd,
          timeout: PR_MERGE_TIMEOUT_MS,
        });

        // Verify actual merge state: --auto may queue the merge rather than merge immediately
        let postMergeState: GitHubPRState;
        try {
          const postMergeOutput = execSync(
            `gh pr view ${pr.github_pr_number} --json state,mergeable,mergeStateStatus${repoFlag}`,
            {
              stdio: 'pipe',
              cwd: repoCwd,
              encoding: 'utf-8',
              timeout: PR_STATE_CHECK_TIMEOUT_MS,
            }
          );
          postMergeState = JSON.parse(postMergeOutput);
        } catch {
          // If we can't re-check, assume it merged (command succeeded)
          results.push({ claimed, outcome: { type: 'merged' } });
          continue;
        }

        if (postMergeState.state === 'MERGED') {
          results.push({ claimed, outcome: { type: 'merged' } });
        } else {
          // PR is OPEN with auto-merge enabled — GitHub will merge when CI passes
          results.push({ claimed, outcome: { type: 'auto_merge_pending' } });
        }
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
          await createLog(phaseDb.provider, {
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
          await phaseDb.provider.withTransaction(async () => {
            await updatePullRequest(phaseDb.provider, pr.id, { status: newStatus });
            if (pr.story_id && prState.state === 'MERGED') {
              const story = await getStoryById(phaseDb.provider, pr.story_id);
              if (story?.assigned_agent_id) {
                const agent = await getAgentById(phaseDb.provider, story.assigned_agent_id);
                if (agent && agent.current_story_id === pr.story_id) {
                  await updateAgent(phaseDb.provider, agent.id, {
                    currentStoryId: null,
                    status: 'idle',
                  });
                }
              }
              await updateStory(phaseDb.provider, pr.story_id, {
                status: 'merged',
                assignedAgentId: null,
              });
              await createLog(phaseDb.provider, {
                agentId: 'manager',
                storyId: pr.story_id,
                eventType: 'STORY_MERGED',
                message: `Story merged (PR #${pr.github_pr_number} was already merged on GitHub)`,
                metadata: { pr_id: pr.id },
              });
              postLifecycleComment(
                phaseDb.provider,
                paths.hiveDir,
                config,
                pr.story_id,
                'merged'
              ).catch(() => {
                /* non-fatal */
              });
            }
            await createLog(phaseDb.provider, {
              agentId: 'manager',
              storyId: pr.story_id || undefined,
              eventType: 'PR_MERGE_SKIPPED',
              message: `PR #${pr.github_pr_number} is already ${prState.state.toLowerCase()}, skipping merge`,
              metadata: { pr_id: pr.id, github_state: prState.state },
            });
          });
          phaseDb.save();

          if (pr.story_id && prState.state === 'MERGED') {
            syncStatusForStory(root, phaseDb.provider, pr.story_id, 'merged');
          }
          break;
        }

        case 'conflicts': {
          await createLog(phaseDb.provider, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): PR has merge conflicts`,
            metadata: { pr_id: pr.id },
          });
          break;
        }

        case 'ci_blocked': {
          await phaseDb.provider.withTransaction(async () => {
            await updatePullRequest(phaseDb.provider, pr.id, { status: 'approved' });
            await createLog(phaseDb.provider, {
              agentId: 'manager',
              storyId: pr.story_id || undefined,
              eventType: 'PR_MERGE_SKIPPED',
              status: 'warn',
              message: `Skipped auto-merge of PR #${pr.github_pr_number}: CI checks are failing (not pre-existing on base branch)`,
              metadata: { pr_id: pr.id },
            });
          });
          phaseDb.save();
          break;
        }

        case 'ci_bypassed': {
          const storyId = pr.story_id;
          const bypassedChecks = result.outcome.bypassedChecks;
          await phaseDb.provider.withTransaction(async () => {
            await updatePullRequest(phaseDb.provider, pr.id, { status: 'merged' });
            if (storyId) {
              await updateStory(phaseDb.provider, storyId, { status: 'merged' });
              const story = await getStoryById(phaseDb.provider, storyId);
              if (story?.assigned_agent_id) {
                const agent = await getAgentById(phaseDb.provider, story.assigned_agent_id);
                if (agent && agent.current_story_id === storyId) {
                  await updateAgent(phaseDb.provider, agent.id, {
                    currentStoryId: null,
                    status: 'idle',
                  });
                }
              }
              await createLog(phaseDb.provider, {
                agentId: 'manager',
                storyId,
                eventType: 'STORY_MERGED',
                message: `Story auto-merged from GitHub PR #${pr.github_pr_number} (bypassed pre-existing CI failures: ${bypassedChecks.join(', ')})`,
              });
            } else {
              await createLog(phaseDb.provider, {
                agentId: 'manager',
                eventType: 'PR_MERGED',
                message: `PR ${pr.id} auto-merged (GitHub PR #${pr.github_pr_number}, bypassed pre-existing CI failures: ${bypassedChecks.join(', ')})`,
                metadata: { pr_id: pr.id },
              });
            }
          });
          phaseDb.save();

          mergedCount++;

          if (storyId) {
            postLifecycleComment(phaseDb.provider, paths.hiveDir, config, storyId, 'merged').catch(
              () => {
                /* non-fatal */
              }
            );
            syncStatusForStory(root, phaseDb.provider, storyId, 'merged');
          }
          break;
        }

        case 'merged': {
          const storyId = pr.story_id;
          await phaseDb.provider.withTransaction(async () => {
            await updatePullRequest(phaseDb.provider, pr.id, { status: 'merged' });
            if (storyId) {
              await updateStory(phaseDb.provider, storyId, { status: 'merged' });
              const story = await getStoryById(phaseDb.provider, storyId);
              if (story?.assigned_agent_id) {
                const agent = await getAgentById(phaseDb.provider, story.assigned_agent_id);
                if (agent && agent.current_story_id === storyId) {
                  await updateAgent(phaseDb.provider, agent.id, {
                    currentStoryId: null,
                    status: 'idle',
                  });
                }
              }
              await createLog(phaseDb.provider, {
                agentId: 'manager',
                storyId,
                eventType: 'STORY_MERGED',
                message: `Story auto-merged from GitHub PR #${pr.github_pr_number}`,
              });
            } else {
              await createLog(phaseDb.provider, {
                agentId: 'manager',
                eventType: 'PR_MERGED',
                message: `PR ${pr.id} auto-merged (GitHub PR #${pr.github_pr_number})`,
                metadata: { pr_id: pr.id },
              });
            }
          });
          phaseDb.save();

          mergedCount++;

          if (storyId) {
            postLifecycleComment(phaseDb.provider, paths.hiveDir, config, storyId, 'merged').catch(
              () => {
                /* non-fatal */
              }
            );
            syncStatusForStory(root, phaseDb.provider, storyId, 'merged');
          }
          break;
        }

        case 'auto_merge_pending': {
          await createLog(phaseDb.provider, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'info',
            message: `PR #${pr.github_pr_number} is queued for auto-merge, waiting for CI checks to complete`,
            metadata: { pr_id: pr.id },
          });
          break;
        }

        case 'branch_updated': {
          // Reset to 'approved' so the PR is retried on the next cycle once CI passes
          await phaseDb.provider.withTransaction(async () => {
            await updatePullRequest(phaseDb.provider, pr.id, { status: 'approved' });
            await createLog(phaseDb.provider, {
              agentId: 'manager',
              storyId: pr.story_id || undefined,
              eventType: 'PR_MERGE_SKIPPED',
              status: 'info',
              message: `Updated stale branch for PR #${pr.github_pr_number} (was behind base branch), will retry merge`,
              metadata: { pr_id: pr.id },
            });
          });
          phaseDb.save();
          break;
        }

        case 'merge_failed': {
          await phaseDb.provider.withTransaction(async () => {
            await updatePullRequest(phaseDb.provider, pr.id, { status: 'approved' });
            await createLog(phaseDb.provider, {
              agentId: 'manager',
              storyId: pr.story_id || undefined,
              eventType: 'PR_MERGE_FAILED',
              status: 'error',
              message: `Failed to auto-merge PR ${pr.id} (GitHub PR #${pr.github_pr_number}): ${result.outcome.type === 'merge_failed' ? result.outcome.error.message : 'Unknown error'}`,
              metadata: { pr_id: pr.id },
            });
          });
          phaseDb.save();
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
