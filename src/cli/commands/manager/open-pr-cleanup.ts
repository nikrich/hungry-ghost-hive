// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { queryAll } from '../../../db/client.js';
import { updatePullRequest } from '../../../db/queries/pull-requests.js';

export interface ClosedOpenPRForMergedStory {
  prId: string;
  storyId: string;
  previousStatus: 'queued' | 'reviewing';
  branchName: string;
  githubPrNumber: number | null;
}

/**
 * Close queued/reviewing PR rows whose linked story is already merged.
 * These rows should no longer appear in queue/review counters.
 */
export function closeOpenPRsForMergedStories(db: Database): ClosedOpenPRForMergedStory[] {
  const staleOpenPRs = queryAll<{
    id: string;
    story_id: string;
    status: 'queued' | 'reviewing';
    branch_name: string;
    github_pr_number: number | null;
  }>(
    db,
    `
      SELECT pr.id, pr.story_id, pr.status, pr.branch_name, pr.github_pr_number
      FROM pull_requests pr
      JOIN stories s ON s.id = pr.story_id
      WHERE pr.status IN ('queued', 'reviewing')
        AND s.status = 'merged'
    `
  );

  const closed: ClosedOpenPRForMergedStory[] = [];
  for (const pr of staleOpenPRs) {
    updatePullRequest(db, pr.id, { status: 'closed' });
    closed.push({
      prId: pr.id,
      storyId: pr.story_id,
      previousStatus: pr.status,
      branchName: pr.branch_name,
      githubPrNumber: pr.github_pr_number,
    });
  }

  return closed;
}
