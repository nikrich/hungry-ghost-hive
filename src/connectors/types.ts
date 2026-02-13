// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Connector abstraction layer — foundational interfaces and types.
 *
 * These interfaces decouple the orchestrator from specific providers (GitHub,
 * Jira, GitLab, Monday, etc.) so that any implementation can be swapped in
 * via the ConnectorRegistry.
 */

// ── Connector Type Enum ─────────────────────────────────────────────────────

/** Known connector types. Extensible via the registry — any string name works. */
export enum ConnectorType {
  // Source control providers
  GitHub = 'github',
  GitLab = 'gitlab',
  Bitbucket = 'bitbucket',

  // Project management providers
  Jira = 'jira',
  Monday = 'monday',
  Linear = 'linear',
}

// ── Connector Config ────────────────────────────────────────────────────────

/** Base configuration every connector receives. */
export interface ConnectorConfig {
  /** The connector name (must match the registered name). */
  name: string;
  /** Provider-specific configuration (opaque to the registry). */
  [key: string]: unknown;
}

// ── Connector Auth ──────────────────────────────────────────────────────────

/** Authentication lifecycle for a connector. */
export interface ConnectorAuth {
  /** Run the interactive authentication flow (OAuth, device-flow, etc.). */
  authenticate(): Promise<void>;
  /** Refresh an expired token, if supported. */
  refreshToken(): Promise<void>;
  /** Whether valid credentials currently exist. */
  isAuthenticated(): Promise<boolean>;
  /** Return current tokens/credentials (opaque record). */
  getTokens(): Record<string, string>;
}

// ── Source Control Connector ────────────────────────────────────────────────

/** Options for creating a pull request. */
export interface PRCreateOptions {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
}

/** Minimal pull request information returned by the connector. */
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

/** A review submitted on a pull request. */
export interface PRReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
  body: string;
}

/** Merge options for a pull request. */
export interface PRMergeOptions {
  method?: 'merge' | 'squash' | 'rebase';
  deleteAfterMerge?: boolean;
}

/**
 * Unified interface for source control providers (GitHub, GitLab, Bitbucket, …).
 */
export interface SourceControlConnector {
  /** Human-readable display name (e.g. "GitHub"). */
  readonly displayName: string;
  /** Connector identifier matching registry key (e.g. "github"). */
  readonly name: string;

  /** Authentication lifecycle. */
  auth: ConnectorAuth;

  /** Create a pull/merge request. */
  createPR(workDir: string, options: PRCreateOptions): Promise<{ number: number; url: string }>;
  /** Fetch a pull request by number. */
  getPR(workDir: string, prNumber: number): Promise<PRInfo>;
  /** List pull requests. */
  listPRs(workDir: string, state?: 'open' | 'closed' | 'all'): Promise<PRInfo[]>;
  /** Merge a pull request. */
  mergePR(workDir: string, prNumber: number, options?: PRMergeOptions): Promise<void>;
  /** Add a comment to a pull request. */
  commentOnPR(workDir: string, prNumber: number, body: string): Promise<void>;
  /** Submit a review on a pull request. */
  reviewPR(workDir: string, prNumber: number, review: PRReview): Promise<void>;
}

// ── Project Management Connector ────────────────────────────────────────────

/** A generic issue/item from an external PM tool. */
export interface ExternalIssue {
  /** Provider-specific ID (e.g. Jira ID "10001"). */
  id: string;
  /** Provider-specific key (e.g. Jira key "PROJ-42"). */
  key: string;
  /** Issue summary/title. */
  title: string;
  /** Plain-text description (provider-specific markup stripped). */
  description: string;
  /** Current status name as it appears in the provider. */
  status: string;
  /** Issue type name (Story, Bug, Epic, Task, …). */
  type: string;
  /** Labels/tags. */
  labels: string[];
  /** Raw provider-specific data for advanced use. */
  raw?: unknown;
}

/** A fetched epic/parent with its metadata. */
export interface ExternalEpic {
  key: string;
  id: string;
  title: string;
  description: string;
  raw?: unknown;
}

/** Options for searching issues. */
export interface IssueSearchOptions {
  query: string;
  maxResults?: number;
  fields?: string[];
}

/** Options for creating an issue. */
export interface IssueCreateOptions {
  projectKey: string;
  title: string;
  type: string;
  description?: string;
  labels?: string[];
  parentKey?: string;
  customFields?: Record<string, unknown>;
}

/** Options for updating an issue. */
export interface IssueUpdateOptions {
  title?: string;
  description?: string;
  labels?: string[];
  customFields?: Record<string, unknown>;
}

/** Result from parsing an epic URL or key. */
export interface ParsedEpicRef {
  /** The issue key extracted (e.g. "PROJ-2"). */
  issueKey: string;
  /** The site/host URL (e.g. "https://mysite.atlassian.net"). */
  siteUrl: string;
}

/**
 * Unified interface for project management providers (Jira, Monday, Linear, …).
 */
export interface ProjectManagementConnector {
  /** Human-readable display name (e.g. "Jira"). */
  readonly displayName: string;
  /** Connector identifier matching registry key (e.g. "jira"). */
  readonly name: string;

  /** Authentication lifecycle. */
  auth: ConnectorAuth;

  /** Fetch a single issue by key or ID. */
  fetchIssue(issueKeyOrId: string): Promise<ExternalIssue>;
  /** Search for issues using a provider-specific query. */
  searchIssues(options: IssueSearchOptions): Promise<ExternalIssue[]>;
  /** Create a new issue/item. */
  createIssue(options: IssueCreateOptions): Promise<{ id: string; key: string }>;
  /** Update an existing issue. */
  updateIssue(issueKeyOrId: string, options: IssueUpdateOptions): Promise<void>;
  /** Transition an issue to a new status. */
  transitionIssue(issueKeyOrId: string, targetStatus: string): Promise<boolean>;
  /** Sync statuses bidirectionally (returns count of items updated). */
  syncStatuses(statusMapping: Record<string, string>): Promise<number>;
  /** Import an epic/parent item from the provider. */
  importEpic(epicKeyOrUrl: string): Promise<ExternalEpic>;

  /** Parse an epic URL or key into a structured reference. Returns null if unparseable. */
  parseEpicRef(epicUrlOrKey: string): ParsedEpicRef | null;
  /** Check whether a string looks like a valid epic URL/key for this provider. */
  isEpicRef(value: string): boolean;
}
