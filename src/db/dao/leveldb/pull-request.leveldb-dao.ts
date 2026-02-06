import { nanoid } from 'nanoid';
import type { PullRequestDao } from '../interfaces/pull-request.dao.js';
import type { PullRequestRow, CreatePullRequestInput, UpdatePullRequestInput, PullRequestStatus } from '../../queries/pull-requests.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';
import { compareIsoAsc, compareIsoDesc } from './sort.js';

const PR_PREFIX = 'pull_request:';

export class LevelDbPullRequestDao implements PullRequestDao {
  private readonly now: NowProvider;

  constructor(private readonly store: LevelDbStore, now: NowProvider = defaultNow) {
    this.now = now;
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequestRow> {
    const id = `pr-${nanoid(8)}`;
    const now = this.now();

    const pr: PullRequestRow = {
      id,
      story_id: input.storyId || null,
      team_id: input.teamId || null,
      branch_name: input.branchName,
      github_pr_number: input.githubPrNumber || null,
      github_pr_url: input.githubPrUrl || null,
      submitted_by: input.submittedBy || null,
      reviewed_by: null,
      status: 'queued',
      review_notes: null,
      created_at: now,
      updated_at: now,
      reviewed_at: null,
    };

    await this.store.put(`${PR_PREFIX}${id}`, pr);
    return pr;
  }

  async getPullRequestById(id: string): Promise<PullRequestRow | undefined> {
    return this.store.get<PullRequestRow>(`${PR_PREFIX}${id}`);
  }

  async getPullRequestByStory(storyId: string): Promise<PullRequestRow | undefined> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs.find(pr => pr.story_id === storyId);
  }

  async getPullRequestByGithubNumber(prNumber: number): Promise<PullRequestRow | undefined> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs.find(pr => pr.github_pr_number === prNumber);
  }

  async getMergeQueue(teamId?: string): Promise<PullRequestRow[]> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs
      .filter(pr => ['queued', 'reviewing'].includes(pr.status))
      .filter(pr => (teamId ? pr.team_id === teamId : true))
      .sort(compareIsoAsc);
  }

  async getNextInQueue(teamId?: string): Promise<PullRequestRow | undefined> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    const queue = prs
      .filter(pr => pr.status === 'queued')
      .filter(pr => (teamId ? pr.team_id === teamId : true))
      .sort(compareIsoAsc);
    return queue[0];
  }

  async getQueuePosition(prId: string): Promise<number> {
    const pr = await this.getPullRequestById(prId);
    if (!pr || !['queued', 'reviewing'].includes(pr.status)) return -1;

    const queue = await this.getMergeQueue(pr.team_id || undefined);
    return queue.findIndex(item => item.id === prId) + 1;
  }

  async getPullRequestsByStatus(status: PullRequestStatus): Promise<PullRequestRow[]> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs.filter(pr => pr.status === status).sort(compareIsoDesc);
  }

  async getApprovedPullRequests(): Promise<PullRequestRow[]> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs.filter(pr => pr.status === 'approved').sort(compareIsoAsc);
  }

  async getAllPullRequests(): Promise<PullRequestRow[]> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs.sort(compareIsoDesc);
  }

  async getPullRequestsByTeam(teamId: string): Promise<PullRequestRow[]> {
    const prs = await this.store.listValues<PullRequestRow>(PR_PREFIX);
    return prs.filter(pr => pr.team_id === teamId).sort(compareIsoDesc);
  }

  async updatePullRequest(id: string, input: UpdatePullRequestInput): Promise<PullRequestRow | undefined> {
    const existing = await this.getPullRequestById(id);
    if (!existing) return undefined;

    const updates: Partial<PullRequestRow> = {};
    if (input.status !== undefined) {
      updates.status = input.status;
      if (['reviewing', 'approved', 'rejected', 'merged'].includes(input.status)) {
        updates.reviewed_at = this.now();
      }
    }
    if (input.reviewedBy !== undefined) updates.reviewed_by = input.reviewedBy;
    if (input.reviewNotes !== undefined) updates.review_notes = input.reviewNotes;
    if (input.githubPrNumber !== undefined) updates.github_pr_number = input.githubPrNumber;
    if (input.githubPrUrl !== undefined) updates.github_pr_url = input.githubPrUrl;

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const updated: PullRequestRow = {
      ...existing,
      ...updates,
      updated_at: this.now(),
    };

    await this.store.put(`${PR_PREFIX}${id}`, updated);
    return updated;
  }

  async deletePullRequest(id: string): Promise<void> {
    await this.store.del(`${PR_PREFIX}${id}`);
  }
}
