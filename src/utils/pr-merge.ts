import { execa } from 'execa';
import type { Database } from 'sql.js';
import { updatePullRequest, type PullRequestRow } from '../db/queries/pull-requests.js';
import { updateStory } from '../db/queries/stories.js';
import { createLog } from '../db/queries/logs.js';

/**
 * Merge a pull request using gh CLI and update database state
 * Returns true if merge was successful, false otherwise
 */
export async function mergePullRequest(root: string, db: Database, pr: PullRequestRow, agentId: string = 'manager'): Promise<boolean> {
  if (!pr.github_pr_number) {
    createLog(db, {
      agentId,
      storyId: pr.story_id || undefined,
      eventType: 'PR_MERGE_FAILED',
      status: 'error',
      message: `Cannot merge PR ${pr.id}: no GitHub PR number`,
      metadata: { pr_id: pr.id },
    });
    return false;
  }

  try {
    // Use gh pr merge to merge the PR
    await execa('gh', ['pr', 'merge', String(pr.github_pr_number), '--auto', '--squash'], {
      cwd: root,
      stdio: 'pipe',
    });

    // Update PR status
    updatePullRequest(db, pr.id, { status: 'merged' });

    // Update story status if associated
    if (pr.story_id) {
      updateStory(db, pr.story_id, { status: 'merged' });
    }

    createLog(db, {
      agentId,
      storyId: pr.story_id || undefined,
      eventType: 'PR_MERGED',
      message: `Merged PR #${pr.github_pr_number}`,
      metadata: { pr_id: pr.id, github_pr_number: pr.github_pr_number },
    });

    return true;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    createLog(db, {
      agentId,
      storyId: pr.story_id || undefined,
      eventType: 'PR_MERGE_FAILED',
      status: 'error',
      message: `Failed to merge PR ${pr.id}: ${errorMessage}`,
      metadata: { pr_id: pr.id, error: errorMessage },
    });
    return false;
  }
}
