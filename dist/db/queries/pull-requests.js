import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
/**
 * Extract GitHub PR number from GitHub PR URL
 * Handles formats like: https://github.com/owner/repo/pull/123
 */
export function extractPRNumberFromUrl(url) {
    if (!url)
        return null;
    const match = url.match(/\/pull\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}
export function createPullRequest(db, input) {
    const id = `pr-${nanoid(8)}`;
    const now = new Date().toISOString();
    // Extract PR number from URL if not explicitly provided
    let prNumber = input.githubPrNumber || null;
    if (!prNumber && input.githubPrUrl) {
        prNumber = extractPRNumberFromUrl(input.githubPrUrl);
    }
    run(db, `
    INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_number, github_pr_url, submitted_by, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `, [
        id,
        input.storyId || null,
        input.teamId || null,
        input.branchName,
        prNumber,
        input.githubPrUrl || null,
        input.submittedBy || null,
        now,
        now,
    ]);
    return getPullRequestById(db, id);
}
export function getPullRequestById(db, id) {
    return queryOne(db, 'SELECT * FROM pull_requests WHERE id = ?', [id]);
}
export function getPullRequestByStory(db, storyId) {
    return queryOne(db, 'SELECT * FROM pull_requests WHERE story_id = ?', [storyId]);
}
export function getPullRequestByGithubNumber(db, prNumber) {
    return queryOne(db, 'SELECT * FROM pull_requests WHERE github_pr_number = ?', [prNumber]);
}
// Merge Queue functions
export function getMergeQueue(db, teamId) {
    if (teamId) {
        return queryAll(db, `
      SELECT * FROM pull_requests
      WHERE team_id = ? AND status IN ('queued', 'reviewing')
      ORDER BY created_at ASC
    `, [teamId]);
    }
    return queryAll(db, `
    SELECT * FROM pull_requests
    WHERE status IN ('queued', 'reviewing')
    ORDER BY created_at ASC
  `);
}
export function getNextInQueue(db, teamId) {
    if (teamId) {
        return queryOne(db, `
      SELECT * FROM pull_requests
      WHERE team_id = ? AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    `, [teamId]);
    }
    return queryOne(db, `
    SELECT * FROM pull_requests
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `);
}
export function getQueuePosition(db, prId) {
    const pr = getPullRequestById(db, prId);
    if (!pr || !['queued', 'reviewing'].includes(pr.status))
        return -1;
    const queue = getMergeQueue(db, pr.team_id || undefined);
    return queue.findIndex(p => p.id === prId) + 1;
}
export function getPullRequestsByStatus(db, status) {
    return queryAll(db, `
    SELECT * FROM pull_requests
    WHERE status = ?
    ORDER BY created_at DESC
  `, [status]);
}
export function getApprovedPullRequests(db) {
    return queryAll(db, `
    SELECT * FROM pull_requests
    WHERE status = 'approved'
    ORDER BY created_at ASC
  `);
}
export function getAllPullRequests(db) {
    return queryAll(db, 'SELECT * FROM pull_requests ORDER BY created_at DESC');
}
export function getPullRequestsByTeam(db, teamId) {
    return queryAll(db, `
    SELECT * FROM pull_requests
    WHERE team_id = ?
    ORDER BY created_at DESC
  `, [teamId]);
}
export function updatePullRequest(db, id, input) {
    const updates = ['updated_at = ?'];
    const values = [new Date().toISOString()];
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
        if (['reviewing', 'approved', 'rejected', 'merged'].includes(input.status)) {
            updates.push('reviewed_at = ?');
            values.push(new Date().toISOString());
        }
    }
    if (input.reviewedBy !== undefined) {
        updates.push('reviewed_by = ?');
        values.push(input.reviewedBy);
    }
    if (input.reviewNotes !== undefined) {
        updates.push('review_notes = ?');
        values.push(input.reviewNotes);
    }
    if (input.githubPrNumber !== undefined) {
        updates.push('github_pr_number = ?');
        values.push(input.githubPrNumber);
    }
    if (input.githubPrUrl !== undefined) {
        updates.push('github_pr_url = ?');
        values.push(input.githubPrUrl);
    }
    if (updates.length === 1) {
        return getPullRequestById(db, id);
    }
    values.push(id);
    run(db, `UPDATE pull_requests SET ${updates.join(', ')} WHERE id = ?`, values);
    return getPullRequestById(db, id);
}
export function deletePullRequest(db, id) {
    run(db, 'DELETE FROM pull_requests WHERE id = ?', [id]);
}
/**
 * Backfill github_pr_number for PRs that have github_pr_url but NULL github_pr_number
 * Returns count of updated records
 */
export function backfillPRNumbersFromUrls(db) {
    const prsToBackfill = queryAll(db, `
    SELECT * FROM pull_requests
    WHERE github_pr_number IS NULL AND github_pr_url IS NOT NULL
  `);
    let count = 0;
    for (const pr of prsToBackfill) {
        const prNumber = extractPRNumberFromUrl(pr.github_pr_url);
        if (prNumber) {
            updatePullRequest(db, pr.id, { githubPrNumber: prNumber });
            count++;
        }
    }
    return count;
}
//# sourceMappingURL=pull-requests.js.map