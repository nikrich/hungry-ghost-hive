import type { PullRequestRow } from '../../queries/pull-requests.js';
import type { CreatePullRequestInput, UpdatePullRequestInput, PullRequestStatus } from '../../queries/pull-requests.js';

export type { PullRequestRow, CreatePullRequestInput, UpdatePullRequestInput, PullRequestStatus };

export interface PullRequestDao {
  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestRow>;
  getPullRequestById(id: string): Promise<PullRequestRow | undefined>;
  getPullRequestByStory(storyId: string): Promise<PullRequestRow | undefined>;
  getPullRequestByGithubNumber(prNumber: number): Promise<PullRequestRow | undefined>;
  getMergeQueue(teamId?: string): Promise<PullRequestRow[]>;
  getNextInQueue(teamId?: string): Promise<PullRequestRow | undefined>;
  getQueuePosition(prId: string): Promise<number>;
  getPullRequestsByStatus(status: PullRequestStatus): Promise<PullRequestRow[]>;
  getApprovedPullRequests(): Promise<PullRequestRow[]>;
  getAllPullRequests(): Promise<PullRequestRow[]>;
  getPullRequestsByTeam(teamId: string): Promise<PullRequestRow[]>;
  updatePullRequest(id: string, input: UpdatePullRequestInput): Promise<PullRequestRow | undefined>;
  deletePullRequest(id: string): Promise<void>;
}
