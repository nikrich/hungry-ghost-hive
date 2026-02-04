import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createPullRequest(db, input) {
    const id = `PR-${nanoid(8)}`;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO pull_requests (id, story_id, github_pr_number, github_pr_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, input.storyId, input.githubPrNumber || null, input.githubPrUrl || null, now, now]);
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
export function getPullRequestsByStatus(db, status) {
    return queryAll(db, `
    SELECT * FROM pull_requests
    WHERE status = ?
    ORDER BY created_at DESC
  `, [status]);
}
export function getOpenPullRequests(db) {
    return queryAll(db, `
    SELECT * FROM pull_requests
    WHERE status IN ('open', 'review')
    ORDER BY created_at
  `);
}
export function getAllPullRequests(db) {
    return queryAll(db, 'SELECT * FROM pull_requests ORDER BY created_at DESC');
}
export function updatePullRequest(db, id, input) {
    const updates = ['updated_at = ?'];
    const values = [new Date().toISOString()];
    if (input.githubPrNumber !== undefined) {
        updates.push('github_pr_number = ?');
        values.push(input.githubPrNumber);
    }
    if (input.githubPrUrl !== undefined) {
        updates.push('github_pr_url = ?');
        values.push(input.githubPrUrl);
    }
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
    }
    if (input.reviewComments !== undefined) {
        updates.push('review_comments = ?');
        values.push(input.reviewComments ? JSON.stringify(input.reviewComments) : null);
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