import { nanoid } from 'nanoid';
export function createPullRequest(db, input) {
    const id = `PR-${nanoid(8)}`;
    const stmt = db.prepare(`
    INSERT INTO pull_requests (id, story_id, github_pr_number, github_pr_url)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(id, input.storyId, input.githubPrNumber || null, input.githubPrUrl || null);
    return getPullRequestById(db, id);
}
export function getPullRequestById(db, id) {
    return db.prepare('SELECT * FROM pull_requests WHERE id = ?').get(id);
}
export function getPullRequestByStory(db, storyId) {
    return db.prepare('SELECT * FROM pull_requests WHERE story_id = ?').get(storyId);
}
export function getPullRequestByGithubNumber(db, prNumber) {
    return db.prepare('SELECT * FROM pull_requests WHERE github_pr_number = ?').get(prNumber);
}
export function getPullRequestsByStatus(db, status) {
    return db.prepare(`
    SELECT * FROM pull_requests
    WHERE status = ?
    ORDER BY created_at DESC
  `).all(status);
}
export function getOpenPullRequests(db) {
    return db.prepare(`
    SELECT * FROM pull_requests
    WHERE status IN ('open', 'review')
    ORDER BY created_at
  `).all();
}
export function getAllPullRequests(db) {
    return db.prepare('SELECT * FROM pull_requests ORDER BY created_at DESC').all();
}
export function updatePullRequest(db, id, input) {
    const updates = ['updated_at = CURRENT_TIMESTAMP'];
    const values = [];
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
    db.prepare(`UPDATE pull_requests SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return getPullRequestById(db, id);
}
export function deletePullRequest(db, id) {
    db.prepare('DELETE FROM pull_requests WHERE id = ?').run(id);
}
//# sourceMappingURL=pull-requests.js.map