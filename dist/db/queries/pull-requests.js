import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createPullRequest(db, input) {
    const id = `pr-${nanoid(8)}`;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_number, github_pr_url, submitted_by, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `, [
        id,
        input.storyId || null,
        input.teamId || null,
        input.branchName,
        input.githubPrNumber || null,
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
//# sourceMappingURL=pull-requests.js.map