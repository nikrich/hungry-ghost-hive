// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Common types shared across project management and source control connectors.
 */

// ── Connector Type ─────────────────────────────────────────────────────────

/** The two categories of external-service connectors */
export type ConnectorType = 'project_management' | 'source_control';

// ── Auth / Config ──────────────────────────────────────────────────────────

/** Base configuration passed to a connector's authenticate() method */
export interface ConnectorConfig {
  /** Provider name (e.g., 'jira', 'github') */
  provider: string;
  /** Provider-specific configuration (e.g., site URL, project key) */
  [key: string]: unknown;
}

/** Authentication credential representation */
export interface ConnectorAuth {
  /** The type of credential (e.g., 'oauth2', 'token', 'cli') */
  type: string;
  /** Access token, if applicable */
  accessToken?: string;
  /** Refresh token, if applicable */
  refreshToken?: string;
  /** Expiry timestamp (ISO 8601), if applicable */
  expiresAt?: string;
}

// ── Project Management Types ───────────────────────────────────────────────

/** Generic issue/epic representation, provider-agnostic */
export interface ConnectorIssue {
  /** Provider-assigned unique ID (e.g., Jira numeric id) */
  id: string;
  /** Human-readable key (e.g., "PROJ-123") */
  key: string;
  /** Issue title / summary */
  summary: string;
  /** Plain-text description */
  description: string;
  /** Current status name */
  status: string;
  /** Issue type name (e.g., 'Story', 'Bug', 'Epic') */
  issueType: string;
  /** Priority name, if available */
  priority?: string;
  /** Labels / tags */
  labels: string[];
  /** Assignee display name, if any */
  assignee?: string;
  /** Reporter display name, if any */
  reporter?: string;
  /** Parent issue key, if this is a subtask */
  parentKey?: string;
  /** Project key or identifier */
  projectKey?: string;
  /** Story point estimate */
  storyPoints?: number | null;
  /** Web URL to view the issue in the provider's UI */
  url?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt: string;
  /** Provider-specific raw data, for cases where generic fields are insufficient */
  raw?: unknown;
}

/** Generic epic representation returned by fetchEpic() */
export interface ConnectorEpic {
  /** Provider-assigned unique ID */
  id: string;
  /** Human-readable key (e.g., "PROJ-42") */
  key: string;
  /** Epic title */
  title: string;
  /** Plain-text description */
  description: string;
  /** The full issue data */
  issue: ConnectorIssue;
}

/** Data required to create a subtask under a parent issue */
export interface SubtaskData {
  /** Summary / title of the subtask */
  summary: string;
  /** Plain-text description */
  description?: string;
  /** Labels / tags */
  labels?: string[];
  /** Story point estimate */
  storyPoints?: number;
  /** Provider-specific extra fields */
  extra?: Record<string, unknown>;
}

/** Options for searching issues */
export interface SearchOpts {
  /** Maximum number of results to return */
  maxResults?: number;
  /** Fields to include in results (provider-specific) */
  fields?: string[];
  /** Pagination token or offset */
  startAt?: number | string;
}

/** Result of parsing a provider URL (e.g., Jira browse URL, Linear issue URL) */
export interface ParsedUrl {
  /** The issue key extracted from the URL */
  issueKey: string;
  /** The provider site/base URL */
  siteUrl: string;
}

// ── Source Control Types ───────────────────────────────────────────────────

/** Data required to create a pull request */
export interface PRData {
  /** PR title */
  title: string;
  /** PR body / description */
  body: string;
  /** Target branch (e.g., 'main') */
  baseBranch: string;
  /** Source branch */
  headBranch: string;
  /** Whether to create as a draft */
  draft?: boolean;
  /** Labels to apply */
  labels?: string[];
  /** Usernames to assign */
  assignees?: string[];
}

/** Generic pull request representation */
export interface PRResult {
  /** Provider-assigned PR identifier (e.g., PR number) */
  id: string;
  /** Web URL to view the PR */
  url: string;
  /** PR title */
  title: string;
  /** Current state */
  state: 'open' | 'closed' | 'merged';
  /** Source branch */
  headBranch: string;
  /** Target branch */
  baseBranch: string;
  /** Lines added */
  additions?: number;
  /** Lines removed */
  deletions?: number;
  /** Number of files changed */
  changedFiles?: number;
}

/** Options for listing pull requests */
export interface ListOpts {
  /** Filter by state */
  state?: 'open' | 'closed' | 'all';
  /** Maximum number of results */
  limit?: number;
}

/** Options for merging a pull request */
export interface MergeOpts {
  /** Merge strategy */
  method?: 'merge' | 'squash' | 'rebase';
  /** Whether to delete the source branch after merge */
  deleteBranch?: boolean;
}

/** Data for submitting a PR review */
export interface ReviewData {
  /** Review verdict */
  state: 'approved' | 'changes_requested' | 'commented';
  /** Review body / comment */
  body: string;
}
