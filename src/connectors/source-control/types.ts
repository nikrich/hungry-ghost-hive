// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type {
  ConnectorPRInfo,
  ConnectorPRResult,
  ConnectorPRReview,
  CreatePROptions,
  MergePROptions,
} from '../common-types.js';

/**
 * Provider-agnostic interface for source control operations.
 *
 * Implementations wrap provider-specific APIs (GitHub, BitBucket, GitLab)
 * behind a uniform contract so the orchestrator never imports provider code directly.
 */
export interface ISourceControlConnector {
  /** The provider identifier (e.g., "github", "bitbucket", "gitlab") */
  readonly provider: string;

  /**
   * Create a new pull request.
   * @param workDir - Repository working directory
   * @param options - PR creation parameters
   */
  createPullRequest(workDir: string, options: CreatePROptions): Promise<ConnectorPRResult>;

  /**
   * Merge an existing pull request.
   * @param workDir - Repository working directory
   * @param prNumber - Pull request number
   * @param options - Merge strategy options
   */
  mergePullRequest(workDir: string, prNumber: number, options?: MergePROptions): Promise<void>;

  /**
   * List pull requests for the repository.
   * @param workDir - Repository working directory
   * @param state - Filter by PR state (default: "open")
   */
  listPullRequests(workDir: string, state?: 'open' | 'closed' | 'all'): Promise<ConnectorPRInfo[]>;

  /**
   * Get the unified diff for a pull request.
   * @param workDir - Repository working directory
   * @param prNumber - Pull request number
   */
  getPullRequestDiff(workDir: string, prNumber: number): Promise<string>;

  /**
   * Add a comment to a pull request.
   * @param workDir - Repository working directory
   * @param prNumber - Pull request number
   * @param body - Comment body text
   */
  addPRComment(workDir: string, prNumber: number, body: string): Promise<void>;

  /**
   * Get all reviews for a pull request.
   * @param workDir - Repository working directory
   * @param prNumber - Pull request number
   */
  getPRReviews(workDir: string, prNumber: number): Promise<ConnectorPRReview[]>;

  /**
   * Approve a pull request.
   * @param workDir - Repository working directory
   * @param prNumber - Pull request number
   * @param body - Optional approval comment
   */
  approvePullRequest(workDir: string, prNumber: number, body?: string): Promise<void>;
}
