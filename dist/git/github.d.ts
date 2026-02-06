export interface PRCreateOptions {
    title: string;
    body: string;
    baseBranch: string;
    headBranch: string;
    draft?: boolean;
    labels?: string[];
    assignees?: string[];
}
export interface PRInfo {
    number: number;
    url: string;
    title: string;
    state: 'open' | 'closed' | 'merged';
    headBranch: string;
    baseBranch: string;
    additions: number;
    deletions: number;
    changedFiles: number;
}
export interface PRReview {
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
    body: string;
}
/**
 * Check if gh CLI is available and authenticated
 */
export declare function isGitHubCLIAvailable(): Promise<boolean>;
/**
 * Create a pull request
 */
export declare function createPullRequest(workDir: string, options: PRCreateOptions): Promise<{
    number: number;
    url: string;
}>;
/**
 * Get pull request information
 */
export declare function getPullRequest(workDir: string, prNumber: number): Promise<PRInfo>;
/**
 * List open pull requests
 */
export declare function listPullRequests(workDir: string, state?: 'open' | 'closed' | 'all'): Promise<PRInfo[]>;
/**
 * Add a comment to a pull request
 */
export declare function commentOnPullRequest(workDir: string, prNumber: number, body: string): Promise<void>;
/**
 * Submit a review on a pull request
 */
export declare function reviewPullRequest(workDir: string, prNumber: number, review: PRReview): Promise<void>;
/**
 * Merge a pull request
 */
export declare function mergePullRequest(workDir: string, prNumber: number, options?: {
    method?: 'merge' | 'squash' | 'rebase';
    deleteAfterMerge?: boolean;
}): Promise<void>;
/**
 * Close a pull request
 */
export declare function closePullRequest(workDir: string, prNumber: number): Promise<void>;
/**
 * Get PR diff
 */
export declare function getPullRequestDiff(workDir: string, prNumber: number): Promise<string>;
/**
 * Get PR reviews
 */
export declare function getPullRequestReviews(workDir: string, prNumber: number): Promise<Array<{
    author: string;
    state: string;
    body: string;
}>>;
//# sourceMappingURL=github.d.ts.map