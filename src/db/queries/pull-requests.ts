import type { Database } from 'sql.js';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run, type PullRequestRow } from '../client.js';

export type { PullRequestRow };

export type PullRequestStatus = 'open' | 'review' | 'approved' | 'merged' | 'closed';

export interface CreatePullRequestInput {
  storyId: string;
  githubPrNumber?: number | null;
  githubPrUrl?: string | null;
}

export interface UpdatePullRequestInput {
  githubPrNumber?: number | null;
  githubPrUrl?: string | null;
  status?: PullRequestStatus;
  reviewComments?: string[] | null;
}

export function createPullRequest(db: Database, input: CreatePullRequestInput): PullRequestRow {
  const id = `PR-${nanoid(8)}`;
  const now = new Date().toISOString();

  run(db, `
    INSERT INTO pull_requests (id, story_id, github_pr_number, github_pr_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, input.storyId, input.githubPrNumber || null, input.githubPrUrl || null, now, now]);

  return getPullRequestById(db, id)!;
}

export function getPullRequestById(db: Database, id: string): PullRequestRow | undefined {
  return queryOne<PullRequestRow>(db, 'SELECT * FROM pull_requests WHERE id = ?', [id]);
}

export function getPullRequestByStory(db: Database, storyId: string): PullRequestRow | undefined {
  return queryOne<PullRequestRow>(db, 'SELECT * FROM pull_requests WHERE story_id = ?', [storyId]);
}

export function getPullRequestByGithubNumber(db: Database, prNumber: number): PullRequestRow | undefined {
  return queryOne<PullRequestRow>(db, 'SELECT * FROM pull_requests WHERE github_pr_number = ?', [prNumber]);
}

export function getPullRequestsByStatus(db: Database, status: PullRequestStatus): PullRequestRow[] {
  return queryAll<PullRequestRow>(db, `
    SELECT * FROM pull_requests
    WHERE status = ?
    ORDER BY created_at DESC
  `, [status]);
}

export function getOpenPullRequests(db: Database): PullRequestRow[] {
  return queryAll<PullRequestRow>(db, `
    SELECT * FROM pull_requests
    WHERE status IN ('open', 'review')
    ORDER BY created_at
  `);
}

export function getAllPullRequests(db: Database): PullRequestRow[] {
  return queryAll<PullRequestRow>(db, 'SELECT * FROM pull_requests ORDER BY created_at DESC');
}

export function updatePullRequest(db: Database, id: string, input: UpdatePullRequestInput): PullRequestRow | undefined {
  const updates: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [new Date().toISOString()];

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

export function deletePullRequest(db: Database, id: string): void {
  run(db, 'DELETE FROM pull_requests WHERE id = ?', [id]);
}
