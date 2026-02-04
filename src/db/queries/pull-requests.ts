import type Database from 'better-sqlite3';
import type { PullRequestRow } from '../client.js';
import { nanoid } from 'nanoid';

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

export function createPullRequest(db: Database.Database, input: CreatePullRequestInput): PullRequestRow {
  const id = `PR-${nanoid(8)}`;

  const stmt = db.prepare(`
    INSERT INTO pull_requests (id, story_id, github_pr_number, github_pr_url)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, input.storyId, input.githubPrNumber || null, input.githubPrUrl || null);
  return getPullRequestById(db, id)!;
}

export function getPullRequestById(db: Database.Database, id: string): PullRequestRow | undefined {
  return db.prepare('SELECT * FROM pull_requests WHERE id = ?').get(id) as PullRequestRow | undefined;
}

export function getPullRequestByStory(db: Database.Database, storyId: string): PullRequestRow | undefined {
  return db.prepare('SELECT * FROM pull_requests WHERE story_id = ?').get(storyId) as PullRequestRow | undefined;
}

export function getPullRequestByGithubNumber(db: Database.Database, prNumber: number): PullRequestRow | undefined {
  return db.prepare('SELECT * FROM pull_requests WHERE github_pr_number = ?').get(prNumber) as PullRequestRow | undefined;
}

export function getPullRequestsByStatus(db: Database.Database, status: PullRequestStatus): PullRequestRow[] {
  return db.prepare(`
    SELECT * FROM pull_requests
    WHERE status = ?
    ORDER BY created_at DESC
  `).all(status) as PullRequestRow[];
}

export function getOpenPullRequests(db: Database.Database): PullRequestRow[] {
  return db.prepare(`
    SELECT * FROM pull_requests
    WHERE status IN ('open', 'review')
    ORDER BY created_at
  `).all() as PullRequestRow[];
}

export function getAllPullRequests(db: Database.Database): PullRequestRow[] {
  return db.prepare('SELECT * FROM pull_requests ORDER BY created_at DESC').all() as PullRequestRow[];
}

export function updatePullRequest(db: Database.Database, id: string, input: UpdatePullRequestInput): PullRequestRow | undefined {
  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: (string | number | null)[] = [];

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

export function deletePullRequest(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM pull_requests WHERE id = ?').run(id);
}
