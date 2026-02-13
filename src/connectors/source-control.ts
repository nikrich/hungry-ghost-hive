// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type {
  ConnectorConfig,
  ListOpts,
  MergeOpts,
  PRData,
  PRResult,
  ReviewData,
} from './types.js';

/**
 * Provider-agnostic interface for source control integrations
 * (GitHub, GitLab, Bitbucket, etc.).
 *
 * Each provider implements this interface, mapping its own API/CLI to the
 * generic connector types defined in `types.ts`.
 */
export interface SourceControlConnector {
  /** Provider identifier (e.g., 'github', 'gitlab', 'bitbucket') */
  readonly name: string;

  /** Initialize authentication using provider-specific config */
  authenticate(config: ConnectorConfig): Promise<void>;

  /** Create a new pull/merge request */
  createPullRequest(data: PRData): Promise<PRResult>;

  /** Get a single pull/merge request by its ID */
  getPullRequest(id: string): Promise<PRResult>;

  /** List pull/merge requests with optional filters */
  listPullRequests(opts?: ListOpts): Promise<PRResult[]>;

  /** Merge a pull/merge request */
  mergePullRequest(id: string, opts?: MergeOpts): Promise<void>;

  /** Submit a review on a pull/merge request */
  reviewPullRequest(id: string, review: ReviewData): Promise<void>;

  /** Add a comment on a pull/merge request */
  commentOnPullRequest(id: string, comment: string): Promise<void>;
}
