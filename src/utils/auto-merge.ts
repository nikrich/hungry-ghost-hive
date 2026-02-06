import { join } from 'path';
import type { DatabaseClient } from '../db/client.js';
import { withTransaction } from '../db/client.js';
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
      } catch (mergeErr) {
        // Log merge failure but continue with other PRs
        createLog(db.db, {
          agentId: 'manager',
          storyId: pr.story_id || undefined,
          eventType: 'PR_MERGE_FAILED',
          status: 'error',
          message: `Failed to auto-merge PR ${pr.id} (GitHub PR #${pr.github_pr_number}): ${mergeErr instanceof Error ? mergeErr.message : 'Unknown error'}`,
          metadata: { pr_id: pr.id },
        });
      }
    } catch {
      // Non-fatal - continue with other PRs
      continue;
    }
  }

  if (mergedCount > 0) {
    db.save();
  }

  return mergedCount;
}
