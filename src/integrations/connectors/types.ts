// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * External reference linking a local entity to a provider resource.
 */
export interface ExternalRef {
  /** Provider name (e.g., 'jira', 'github', 'linear') */
  provider: string;
  /** Provider-specific unique ID */
  externalId: string;
  /** Provider-specific key (e.g., Jira issue key 'HIVE-42') */
  externalKey: string;
  /** URL to view the resource in the provider's UI */
  externalUrl?: string;
}

/**
 * Metadata describing a connector for registry and UI purposes.
 */
export interface ConnectorInfo {
  /** Machine-readable provider name (e.g., 'jira', 'github') */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Whether the connector is ready for use (false = coming soon) */
  available: boolean;
  /** Show as "coming soon" in wizard UI */
  comingSoon?: boolean;
}

/**
 * Setup wizard provided by a connector for interactive configuration.
 */
export interface SetupWizard {
  /** Run the interactive setup flow, returning provider-specific config */
  run(): Promise<Record<string, unknown>>;
}

/**
 * Result of creating an issue or epic in a project management tool.
 */
export interface PMCreateResult {
  ref: ExternalRef;
}

/**
 * Fetched epic/parent data from a project management tool.
 */
export interface PMFetchedEpic {
  key: string;
  id: string;
  title: string;
  description: string;
  /** Provider-specific raw data */
  raw?: unknown;
}

/**
 * Options for creating an epic in a project management tool.
 */
export interface PMCreateEpicOptions {
  title: string;
  description: string;
  projectKey: string;
  labels?: string[];
}

/**
 * Options for creating an issue in a project management tool.
 */
export interface PMCreateIssueOptions {
  title: string;
  description: string;
  projectKey: string;
  issueType?: string;
  parentKey?: string;
  storyPoints?: number;
  labels?: string[];
  /** Provider-specific additional fields */
  extra?: Record<string, unknown>;
}

/**
 * Options for creating a subtask under a parent issue.
 */
export interface PMCreateSubtaskOptions {
  parentKey: string;
  projectKey: string;
  title: string;
  description?: string;
  labels?: string[];
}

/**
 * Options for transitioning an issue to a new status.
 */
export interface PMTransitionOptions {
  issueKeyOrId: string;
  targetStatus: string;
  statusMapping?: Record<string, string>;
}

/**
 * Options for posting a comment to an issue.
 */
export interface PMCommentOptions {
  issueKeyOrId: string;
  body: string;
  /** Optional structured event type for lifecycle tracking */
  event?: string;
  /** Additional context (agent name, PR URL, etc.) */
  context?: Record<string, string>;
}

/**
 * Options for syncing a requirement and its stories to the PM tool.
 */
export interface PMSyncRequirementOptions {
  requirementId: string;
  storyIds: string[];
  teamName?: string;
}

/**
 * Result of syncing a requirement to the PM tool.
 */
export interface PMSyncResult {
  epicRef: ExternalRef | null;
  stories: Array<{
    storyId: string;
    ref: ExternalRef;
  }>;
  errors: string[];
}

/**
 * Interface that all project management connectors must implement.
 *
 * Wraps provider-specific operations (Jira, Linear, Asana, etc.)
 * behind a common interface so orchestration code can be provider-agnostic.
 */
export interface ProjectManagementConnector {
  /** Connector metadata */
  readonly info: ConnectorInfo;

  /** Authenticate with the provider (e.g., run OAuth flow) */
  authenticate(): Promise<void>;

  /** Check whether valid credentials exist */
  isAuthenticated(): Promise<boolean>;

  /** Fetch an epic/parent issue by key or URL */
  fetchEpic(keyOrUrl: string): Promise<PMFetchedEpic>;

  /** Create a new epic */
  createEpic(options: PMCreateEpicOptions): Promise<PMCreateResult>;

  /** Create a new issue */
  createIssue(options: PMCreateIssueOptions): Promise<PMCreateResult>;

  /** Create a subtask under a parent issue */
  createSubtask(options: PMCreateSubtaskOptions): Promise<PMCreateResult>;

  /** Transition an issue to a new status */
  transitionIssue(options: PMTransitionOptions): Promise<boolean>;

  /** Post a comment on an issue */
  postComment(options: PMCommentOptions): Promise<boolean>;

  /** Sync a requirement and its stories to the PM tool */
  syncRequirement(options: PMSyncRequirementOptions): Promise<PMSyncResult>;

  /** Get the setup wizard for interactive configuration */
  getSetupWizard(): SetupWizard;

  /** Get provider-specific instructions for agents */
  getInstructions(): string;
}

/**
 * Options for creating a pull request via a source control connector.
 */
export interface SCCreatePROptions {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  draft?: boolean;
  labels?: string[];
  assignees?: string[];
}

/**
 * Pull request information returned by source control connectors.
 */
export interface SCPullRequestInfo {
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

/**
 * Interface that all source control connectors must implement.
 *
 * Wraps provider-specific operations (GitHub, GitLab, Bitbucket, etc.)
 * behind a common interface.
 */
export interface SourceControlConnector {
  /** Connector metadata */
  readonly info: ConnectorInfo;

  /** Authenticate with the provider */
  authenticate(): Promise<void>;

  /** Check whether valid credentials exist */
  isAuthenticated(): Promise<boolean>;

  /** Create a pull request */
  createPullRequest(workDir: string, options: SCCreatePROptions): Promise<{ number: number; url: string }>;

  /** Get pull request details by number */
  getPullRequest(workDir: string, prNumber: number): Promise<SCPullRequestInfo>;

  /** Merge a pull request */
  mergePullRequest(
    workDir: string,
    prNumber: number,
    options?: { method?: 'merge' | 'squash' | 'rebase'; deleteAfterMerge?: boolean }
  ): Promise<void>;

  /** List pull requests */
  listPullRequests(
    workDir: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<SCPullRequestInfo[]>;
}
