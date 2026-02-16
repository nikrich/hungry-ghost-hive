// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Provider-agnostic types shared across all connector interfaces.
 * These types decouple the orchestrator from any specific integration provider.
 */

// ── Provider Identification ─────────────────────────────────────────────────

/** Supported source control providers */
export type SourceControlProvider = 'github' | 'bitbucket' | 'gitlab';

/** Supported project management providers */
export type ProjectManagementProvider = 'jira' | 'linear' | 'monday' | 'github_projects';

// ── Epic ────────────────────────────────────────────────────────────────────

/** Provider-agnostic epic representation */
export interface ConnectorEpic {
  /** External issue key (e.g., "HIVE-2") */
  key: string;
  /** External issue ID */
  id: string;
  /** Epic title / summary */
  title: string;
  /** Plain-text description */
  description: string;
  /** Provider that owns this epic */
  provider: string;
  /** Provider-specific raw data (e.g., full issue object from the PM provider) */
  raw?: unknown;
}

// ── Issue / Story ───────────────────────────────────────────────────────────

/** Provider-agnostic issue representation */
export interface ConnectorIssue {
  /** External issue key (e.g., "HIVE-42") */
  key: string;
  /** External issue ID */
  id: string;
  /** Issue title / summary */
  title: string;
  /** Plain-text description */
  description: string;
  /** Current status name as reported by the provider */
  status: string;
  /** Issue type name (e.g., "Story", "Bug", "Task") */
  issueType: string;
  /** Labels attached to the issue */
  labels: string[];
  /** Assignee display name, if assigned */
  assignee?: string;
  /** Story points, if set */
  storyPoints?: number;
  /** Parent issue key (e.g., epic key), if any */
  parentKey?: string;
  /** Provider that owns this issue */
  provider: string;
  /** Provider-specific raw data */
  raw?: unknown;
}

// ── Pull Request ────────────────────────────────────────────────────────────

/** Result from creating a pull request */
export interface ConnectorPRResult {
  /** PR number */
  number: number;
  /** Full URL to the PR */
  url: string;
}

/** Pull request info returned from listing/fetching PRs */
export interface ConnectorPRInfo {
  /** PR number */
  number: number;
  /** Full URL to the PR */
  url: string;
  /** PR title */
  title: string;
  /** Current state */
  state: 'open' | 'closed' | 'merged';
  /** Head (source) branch */
  headBranch: string;
  /** Base (target) branch */
  baseBranch: string;
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** Number of changed files */
  changedFiles: number;
}

/** Pull request review */
export interface ConnectorPRReview {
  /** Reviewer identifier */
  author: string;
  /** Review verdict */
  state: 'approved' | 'changes_requested' | 'commented' | 'pending';
  /** Review body text */
  body: string;
}

// ── Parsed Epic URL ─────────────────────────────────────────────────────────

/** Result of parsing a provider-specific epic URL */
export interface ConnectorParsedEpicUrl {
  /** The issue key extracted from the URL (e.g., "HIVE-2") */
  issueKey: string;
  /** The provider site URL (e.g., "https://mycompany.atlassian.net") */
  siteUrl: string;
  /** Provider that owns this URL */
  provider: string;
}

// ── Auth ────────────────────────────────────────────────────────────────────

/** Result from an authentication attempt */
export interface ConnectorAuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Provider name */
  provider: string;
  /** Human-readable status message */
  message?: string;
}

// ── Sync ────────────────────────────────────────────────────────────────────

/** Result from a sync operation */
export interface ConnectorSyncResult {
  /** Number of entities updated */
  updatedCount: number;
  /** Errors encountered during sync (non-fatal) */
  errors: string[];
}

// ── Lifecycle Events ────────────────────────────────────────────────────

/** Provider-agnostic lifecycle events that trigger comments */
export type ConnectorLifecycleEvent =
  | 'assigned'
  | 'work_started'
  | 'progress'
  | 'approach_posted'
  | 'pr_created'
  | 'qa_started'
  | 'qa_passed'
  | 'qa_failed'
  | 'merged'
  | 'blocked';

/** Context for posting lifecycle event comments */
export interface ConnectorCommentContext {
  agentName?: string;
  branchName?: string;
  prUrl?: string;
  reason?: string;
  subtaskKey?: string;
  approachText?: string;
}

/** Options for creating a subtask */
export interface ConnectorCreateSubtaskOptions {
  parentIssueKey: string;
  projectKey: string;
  agentName: string;
  storyTitle: string;
  approachSteps?: string[];
}

/** Result from creating a subtask */
export interface ConnectorSubtaskResult {
  key: string;
  id: string;
}

// ── Options ─────────────────────────────────────────────────────────────────

/** Options for creating a pull request */
export interface CreatePROptions {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
}

/** Options for merging a pull request */
export interface MergePROptions {
  method?: 'merge' | 'squash' | 'rebase';
  deleteAfterMerge?: boolean;
}

/** Options for creating an epic */
export interface CreateEpicOptions {
  projectKey: string;
  title: string;
  description: string;
  labels?: string[];
}

/** Options for creating a story */
export interface CreateStoryOptions {
  projectKey: string;
  title: string;
  description: string;
  epicKey?: string;
  storyPoints?: number;
  labels?: string[];
}

/** Options for searching issues */
export interface SearchIssuesOptions {
  maxResults?: number;
  fields?: string[];
}

// ── Sign-Off Report ──────────────────────────────────────────────────────

/** Provider-agnostic sign-off report data */
export interface ConnectorSignOffReportData {
  requirementId: string;
  requirementTitle: string;
  featureBranch: string;
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration?: string;
  failedTestNames?: string[];
  errorSummary?: string;
  storiesMerged: number;
  teamNames: string[];
}
