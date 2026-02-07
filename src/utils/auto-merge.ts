import { join } from 'path';
import type { DatabaseClient } from '../db/client.js';
import { queryOne, withTransaction } from '../db/client.js';
import { createLog } from '../db/queries/logs.js';
import { getApprovedPullRequests, updatePullRequest } from '../db/queries/pull-requests.js';
import { updateStory } from '../db/queries/stories.js';
import { getAllTeams } from '../db/queries/teams.js';

/** Timeout in ms for checking PR state via GitHub API */
const PR_STATE_CHECK_TIMEOUT_MS = 30000;
/** Timeout in ms for GitHub merge operations */
const PR_MERGE_TIMEOUT_MS = 60000;

interface GitHubPRState {
  state: string;
  mergeable: string;
}

/**
 * Auto-merge all approved PRs that are ready to merge
 * Can be called immediately after PR approval or from manager daemon
 *
 * @param root - Hive root directory
 * @param db - Database client
 * @returns Number of PRs successfully merged
 */
export async function autoMergeApprovedPRs(root: string, db: DatabaseClient): Promise<number> {
  const approvedPRs = getApprovedPullRequests(db.db);
  if (approvedPRs.length === 0) return 0;

  let mergedCount = 0;

  for (const pr of approvedPRs) {
    // Skip PRs without GitHub PR numbers
    if (!pr.github_pr_number) continue;

    try {
      // Atomically claim this PR for merging using optimistic locking
      // This prevents race conditions when multiple managers run concurrently
      let claimed = false;
      await withTransaction(db.db, () => {
        // Re-fetch PR status to ensure it's still 'approved'
        const currentPR = queryOne<{ status: string }>(
          db.db,
          `SELECT status FROM pull_requests WHERE id = ?`,
          [pr.id]
        );

        if (currentPR?.status === 'approved') {
          // Update to 'queued' status (temporary merge-in-progress state)
          // Only this manager will proceed if status was 'approved'
          updatePullRequest(db.db, pr.id, { status: 'queued' });
          claimed = true;
        }
      });
      db.save();

      // If we didn't claim the PR, another manager is already merging it
      if (!claimed) continue;

      // Get team to find repo path
      let teamId = pr.team_id;
      let repoCwd = root;

      if (teamId) {
        const team = getAllTeams(db.db).find(t => t.id === teamId);
        if (team?.repo_path) {
          repoCwd = join(root, team.repo_path);
        }
      } else if (pr.branch_name) {
        // Try to find team by matching branch name pattern
        const teams = getAllTeams(db.db);
        for (const team of teams) {
          if (team.repo_path) {
            repoCwd = join(root, team.repo_path);
            teamId = team.id;
            break;
          }
        }
      }

      // Check if PR is still open and mergeable before attempting merge
      const { execSync } = await import('child_process');
      try {
        // Verify PR state and mergeable status
        let prState: GitHubPRState;
        let mergeableStatus: boolean;
        try {
          const prViewOutput = execSync(
            `gh pr view ${pr.github_pr_number} --json state,mergeable`,
            {
              stdio: 'pipe',
              cwd: repoCwd,
              encoding: 'utf-8',
              timeout: PR_STATE_CHECK_TIMEOUT_MS,
            }
          );
          prState = JSON.parse(prViewOutput);
          mergeableStatus = prState.mergeable === 'MERGEABLE';
        } catch (_error) {
          // If we can't determine PR status, skip this PR
          createLog(db.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): Could not determine PR status`,
            metadata: { pr_id: pr.id },
          });
          continue;
        }

        // Check if PR is still open
        if (prState.state !== 'OPEN') {
          // PR is not open (closed, merged, or draft), skip merge attempt
          const newStatus = prState.state === 'MERGED' ? 'merged' : 'closed';
          await withTransaction(db.db, () => {
            updatePullRequest(db.db, pr.id, { status: newStatus });
            createLog(db.db, {
              agentId: 'manager',
              storyId: pr.story_id || undefined,
              eventType: 'PR_MERGE_SKIPPED',
              message: `PR #${pr.github_pr_number} is already ${prState.state.toLowerCase()}, skipping merge`,
              metadata: { pr_id: pr.id, github_state: prState.state },
            });
          });
          db.save();
          continue;
        }

        // Check if PR has merge conflicts
        if (!mergeableStatus) {
          // PR has conflicts - skip merge
          createLog(db.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_SKIPPED',
            status: 'warn',
            message: `Skipped auto-merge of PR ${pr.id} (GitHub PR #${pr.github_pr_number}): PR has merge conflicts`,
            metadata: { pr_id: pr.id },
          });
          continue;
        }

        // Use --auto flag to enable GitHub's auto-merge feature (idempotent if already merged)
        // Add timeout to prevent blocking the manager daemon (60s for GitHub API operations)
        execSync(`gh pr merge ${pr.github_pr_number} --auto --squash --delete-branch`, {
          stdio: 'pipe',
          cwd: repoCwd,
          timeout: PR_MERGE_TIMEOUT_MS,
        });

        // Update PR and story status, create logs (atomic transaction)
        const storyId = pr.story_id;
        await withTransaction(db.db, () => {
          updatePullRequest(db.db, pr.id, { status: 'merged' });

          if (storyId) {
            updateStory(db.db, storyId, { status: 'merged' });
            createLog(db.db, {
              agentId: 'manager',
              storyId: storyId,
              eventType: 'STORY_MERGED',
              message: `Story auto-merged from GitHub PR #${pr.github_pr_number}`,
            });
          } else {
            createLog(db.db, {
              agentId: 'manager',
              eventType: 'PR_MERGED',
              message: `PR ${pr.id} auto-merged (GitHub PR #${pr.github_pr_number})`,
              metadata: { pr_id: pr.id },
            });
          }
        });

        mergedCount++;
        db.save();
      } catch (mergeErr) {
        // Merge failed - revert PR status back to approved for retry (atomic transaction)
        await withTransaction(db.db, () => {
          updatePullRequest(db.db, pr.id, { status: 'approved' });
          createLog(db.db, {
            agentId: 'manager',
            storyId: pr.story_id || undefined,
            eventType: 'PR_MERGE_FAILED',
            status: 'error',
            message: `Failed to auto-merge PR ${pr.id} (GitHub PR #${pr.github_pr_number}): ${mergeErr instanceof Error ? mergeErr.message : 'Unknown error'}`,
            metadata: { pr_id: pr.id },
          });
        });
        db.save();
      }
    } catch (_error) {
      // Non-fatal - continue with other PRs
      continue;
    }
  }

  return mergedCount;
}
