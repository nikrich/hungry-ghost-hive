import { join } from 'path';
import type { DatabaseClient } from '../db/client.js';
import { withTransaction, queryOne } from '../db/client.js';
import { getApprovedPullRequests, updatePullRequest } from '../db/queries/pull-requests.js';
import { getAllTeams } from '../db/queries/teams.js';
import { updateStory } from '../db/queries/stories.js';
import { createLog } from '../db/queries/logs.js';

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

      // Attempt to merge on GitHub
      const { execSync } = await import('child_process');
      try {
        // Use --auto flag to enable GitHub's auto-merge feature (idempotent if already merged)
        // Add timeout to prevent blocking the manager daemon (60s for GitHub API operations)
        execSync(`gh pr merge ${pr.github_pr_number} --auto --squash --delete-branch`, {
          stdio: 'pipe',
          cwd: repoCwd,
          timeout: 60000 // 60 second timeout for GitHub operations
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
        // Merge failed - revert PR status back to approved for retry
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
    } catch {
      // Non-fatal - continue with other PRs
      continue;
    }
  }

  return mergedCount;
}
