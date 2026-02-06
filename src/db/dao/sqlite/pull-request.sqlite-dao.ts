import type { Database } from 'sql.js';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../../client.js';
import type { PullRequestDao } from '../interfaces/pull-request.dao.js';
import type { PullRequestRow, CreatePullRequestInput, UpdatePullRequestInput, PullRequestStatus } from '../../queries/pull-requests.js';

export class SqlitePullRequestDao implements PullRequestDao {
  constructor(private readonly db: Database) {}

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestRow> {
    const id = `pr-${nanoid(8)}`;
    const now = new Date().toISOString();

    run(this.db, `
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

    return (await this.getPullRequestById(id))!;
  }

  async getPullRequestById(id: string): Promise<PullRequestRow | undefined> {
    return queryOne<PullRequestRow>(this.db, 'SELECT * FROM pull_requests WHERE id = ?', [id]);
  }

  async getPullRequestByStory(storyId: string): Promise<PullRequestRow | undefined> {
    return queryOne<PullRequestRow>(this.db, 'SELECT * FROM pull_requests WHERE story_id = ?', [storyId]);
  }

  async getPullRequestByGithubNumber(prNumber: number): Promise<PullRequestRow | undefined> {
    return queryOne<PullRequestRow>(this.db, 'SELECT * FROM pull_requests WHERE github_pr_number = ?', [prNumber]);
  }

  async getMergeQueue(teamId?: string): Promise<PullRequestRow[]> {
    if (teamId) {
      return queryAll<PullRequestRow>(this.db, `
        SELECT * FROM pull_requests
        WHERE team_id = ? AND status IN ('queued', 'reviewing')
        ORDER BY created_at ASC
      `, [teamId]);
    }
    return queryAll<PullRequestRow>(this.db, `
      SELECT * FROM pull_requests
      WHERE status IN ('queued', 'reviewing')
      ORDER BY created_at ASC
    `);
  }

  async getNextInQueue(teamId?: string): Promise<PullRequestRow | undefined> {
    if (teamId) {
      return queryOne<PullRequestRow>(this.db, `
        SELECT * FROM pull_requests
        WHERE team_id = ? AND status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `, [teamId]);
    }
    return queryOne<PullRequestRow>(this.db, `
      SELECT * FROM pull_requests
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    `);
  }

  async getQueuePosition(prId: string): Promise<number> {
    const pr = await this.getPullRequestById(prId);
    if (!pr || !['queued', 'reviewing'].includes(pr.status)) return -1;

    const queue = await this.getMergeQueue(pr.team_id || undefined);
    return queue.findIndex(p => p.id === prId) + 1;
  }

  async getPullRequestsByStatus(status: PullRequestStatus): Promise<PullRequestRow[]> {
    return queryAll<PullRequestRow>(this.db, `
      SELECT * FROM pull_requests
      WHERE status = ?
      ORDER BY created_at DESC
    `, [status]);
  }

  async getApprovedPullRequests(): Promise<PullRequestRow[]> {
    return queryAll<PullRequestRow>(this.db, `
      SELECT * FROM pull_requests
      WHERE status = 'approved'
      ORDER BY created_at ASC
    `);
  }

  async getAllPullRequests(): Promise<PullRequestRow[]> {
    return queryAll<PullRequestRow>(this.db, 'SELECT * FROM pull_requests ORDER BY created_at DESC');
  }

  async getPullRequestsByTeam(teamId: string): Promise<PullRequestRow[]> {
    return queryAll<PullRequestRow>(this.db, `
      SELECT * FROM pull_requests
      WHERE team_id = ?
      ORDER BY created_at DESC
    `, [teamId]);
  }

  async updatePullRequest(id: string, input: UpdatePullRequestInput): Promise<PullRequestRow | undefined> {
    const updates: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [new Date().toISOString()];

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
      return this.getPullRequestById(id);
    }

    values.push(id);
    run(this.db, `UPDATE pull_requests SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getPullRequestById(id);
  }

  async deletePullRequest(id: string): Promise<void> {
    run(this.db, 'DELETE FROM pull_requests WHERE id = ?', [id]);
  }
}
