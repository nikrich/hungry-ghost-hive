export interface BranchInfo {
    name: string;
    current: boolean;
    remote?: string;
    upstream?: string;
    lastCommit: string;
}
/**
 * Get current branch name
 */
export declare function getCurrentBranch(workDir: string): Promise<string>;
/**
 * List all local branches
 */
export declare function listBranches(workDir: string): Promise<BranchInfo[]>;
/**
 * Create a new branch
 */
export declare function createBranch(workDir: string, name: string, startPoint?: string): Promise<void>;
/**
 * Checkout a branch
 */
export declare function checkoutBranch(workDir: string, name: string, create?: boolean): Promise<void>;
/**
 * Delete a branch
 */
export declare function deleteBranch(workDir: string, name: string, force?: boolean): Promise<void>;
/**
 * Check if branch exists
 */
export declare function branchExists(workDir: string, name: string): Promise<boolean>;
/**
 * Get branch tracking info
 */
export declare function getBranchTracking(workDir: string, branch: string): Promise<{
    upstream: string | null;
    ahead: number;
    behind: number;
}>;
/**
 * Push branch to remote
 */
export declare function pushBranch(workDir: string, branch: string, remote?: string, setUpstream?: boolean): Promise<void>;
/**
 * Create and checkout a feature branch
 */
export declare function createFeatureBranch(workDir: string, storyId: string, description: string, baseBranch?: string): Promise<string>;
/**
 * Merge a branch
 */
export declare function mergeBranch(workDir: string, branch: string, noFf?: boolean): Promise<void>;
//# sourceMappingURL=branches.d.ts.map