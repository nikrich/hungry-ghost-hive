import type { Database } from 'sql.js';
import { type PullRequestRow } from '../client.js';
export type { PullRequestRow };
export type PullRequestStatus = 'queued' | 'reviewing' | 'approved' | 'merged' | 'rejected' | 'closed';
export interface CreatePullRequestInput {
    storyId?: string | null;
    teamId?: string | null;
    branchName: string;
    githubPrNumber?: number | null;
    githubPrUrl?: string | null;
    submittedBy?: string | null;
}
export interface UpdatePullRequestInput {
    status?: PullRequestStatus;
    reviewedBy?: string | null;
    reviewNotes?: string | null;
    githubPrNumber?: number | null;
    githubPrUrl?: string | null;
}
export declare function createPullRequest(db: Database, input: CreatePullRequestInput): PullRequestRow;
export declare function getPullRequestById(db: Database, id: string): PullRequestRow | undefined;
export declare function getPullRequestByStory(db: Database, storyId: string): PullRequestRow | undefined;
export declare function getPullRequestByGithubNumber(db: Database, prNumber: number): PullRequestRow | undefined;
export declare function getMergeQueue(db: Database, teamId?: string): PullRequestRow[];
export declare function getNextInQueue(db: Database, teamId?: string): PullRequestRow | undefined;
export declare function getQueuePosition(db: Database, prId: string): number;
export declare function getPullRequestsByStatus(db: Database, status: PullRequestStatus): PullRequestRow[];
export declare function getApprovedPullRequests(db: Database): PullRequestRow[];
export declare function getOpenPullRequestsByStory(db: Database, storyId: string): PullRequestRow[];
export declare function getAllPullRequests(db: Database): PullRequestRow[];
export declare function getPullRequestsByTeam(db: Database, teamId: string): PullRequestRow[];
export declare function updatePullRequest(db: Database, id: string, input: UpdatePullRequestInput): PullRequestRow | undefined;
export declare function deletePullRequest(db: Database, id: string): void;
/**
 * Backfill github_pr_number for existing PRs that have github_pr_url but no number
 * This is an idempotent operation - it only updates PRs with NULL github_pr_number
 * @returns Number of PRs updated
 */
export declare function backfillGithubPrNumbers(db: Database): number;
//# sourceMappingURL=pull-requests.d.ts.map