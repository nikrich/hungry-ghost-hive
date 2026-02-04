import type { Database } from 'sql.js';
import { type PullRequestRow } from '../client.js';
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
export declare function createPullRequest(db: Database, input: CreatePullRequestInput): PullRequestRow;
export declare function getPullRequestById(db: Database, id: string): PullRequestRow | undefined;
export declare function getPullRequestByStory(db: Database, storyId: string): PullRequestRow | undefined;
export declare function getPullRequestByGithubNumber(db: Database, prNumber: number): PullRequestRow | undefined;
export declare function getPullRequestsByStatus(db: Database, status: PullRequestStatus): PullRequestRow[];
export declare function getOpenPullRequests(db: Database): PullRequestRow[];
export declare function getAllPullRequests(db: Database): PullRequestRow[];
export declare function updatePullRequest(db: Database, id: string, input: UpdatePullRequestInput): PullRequestRow | undefined;
export declare function deletePullRequest(db: Database, id: string): void;
//# sourceMappingURL=pull-requests.d.ts.map