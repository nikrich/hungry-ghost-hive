// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Generic connector interfaces for project management (PM) and
 * source code management (SCM) integrations.
 *
 * These interfaces decouple the Hive orchestrator from specific providers
 * like Jira or GitHub, allowing new integrations (Monday, GitLab, Linear, etc.)
 * to be added by implementing the same contract.
 */

import type {
  CreateEpicInput,
  CreateIssueResult,
  CreatePRInput,
  CreatePRResult,
  CreateStoryInput,
  CreateSubtaskInput,
  DependencyLinkType,
  ExternalEpic,
  ExternalIssue,
  ExternalPRReview,
  ExternalPullRequest,
  ExternalSprint,
  ExternalTransition,
  LifecycleCommentContext,
  LifecycleEvent,
  MergePROptions,
} from './types.js';

// ── Project Management Connector ────────────────────────────────────────────

/**
 * Interface for project management tool integrations (Jira, Monday, Linear, etc.).
 *
 * Implementations wrap a specific provider's API and translate between
 * the provider's native data model and Hive's generic types.
 */
export interface ProjectManagementConnector {
  /** Unique identifier for this connector type (e.g., "jira", "monday") */
  readonly type: string;

  /** Human-readable provider name (e.g., "Jira", "Monday.com") */
  readonly displayName: string;

  /**
   * Authenticate with the PM provider.
   * Implementations should handle OAuth flows, token refresh, etc.
   * @returns true if authentication succeeded
   */
  authenticate(): Promise<boolean>;

  /**
   * Check whether a URL belongs to this PM provider.
   * Used for URL-based epic import to determine which connector should handle it.
   * @param url - URL to check
   * @returns true if this connector recognizes the URL
   */
  recognizesUrl(url: string): boolean;

  // ── Epic Operations ─────────────────────────────────────────────────────

  /**
   * Fetch an epic from the PM tool by its URL or key.
   * Used during requirement import (`hive req <url>`).
   * @param urlOrKey - A URL or issue key identifying the epic
   * @returns The fetched epic data
   */
  fetchEpic(urlOrKey: string): Promise<ExternalEpic>;

  /**
   * Create a new epic in the PM tool.
   * @param input - Epic creation data
   * @returns The created epic reference
   */
  createEpic(input: CreateEpicInput): Promise<CreateIssueResult>;

  // ── Story/Issue Operations ──────────────────────────────────────────────

  /**
   * Create a new story/issue in the PM tool.
   * @param input - Story creation data
   * @returns The created issue reference
   */
  createStory(input: CreateStoryInput): Promise<CreateIssueResult>;

  /**
   * Create a subtask under a parent issue (e.g., for agent implementation tracking).
   * @param input - Subtask creation data
   * @returns The created subtask reference, or null if creation failed
   */
  createSubtask(input: CreateSubtaskInput): Promise<CreateIssueResult | null>;

  /**
   * Fetch an issue by its key.
   * @param issueKey - The issue key (e.g., "PROJ-123")
   * @returns The fetched issue
   */
  fetchIssue(issueKey: string): Promise<ExternalIssue>;

  // ── Comments & Progress ─────────────────────────────────────────────────

  /**
   * Post a lifecycle event comment on an issue.
   * @param issueKey - Target issue key
   * @param event - The lifecycle event type
   * @param context - Additional context for the comment
   * @returns true if the comment was posted successfully
   */
  postComment(
    issueKey: string,
    event: LifecycleEvent,
    context?: LifecycleCommentContext
  ): Promise<boolean>;

  /**
   * Post a progress update to a subtask.
   * @param subtaskKey - The subtask key
   * @param message - Progress message text
   * @param agentName - Name of the agent posting the update
   * @returns true if the update was posted successfully
   */
  postProgress(subtaskKey: string, message: string, agentName?: string): Promise<boolean>;

  // ── Status Transitions ──────────────────────────────────────────────────

  /**
   * Transition an issue to a target status.
   * The connector should look up available transitions and apply the matching one.
   * @param issueKey - The issue key to transition
   * @param targetStatus - The target status name (e.g., "In Progress", "Done")
   * @returns true if the transition succeeded
   */
  transitionStatus(issueKey: string, targetStatus: string): Promise<boolean>;

  /**
   * Get available transitions for an issue.
   * @param issueKey - The issue key
   * @returns List of available transitions
   */
  getTransitions(issueKey: string): Promise<ExternalTransition[]>;

  // ── Dependencies ────────────────────────────────────────────────────────

  /**
   * Create a dependency link between two issues.
   * @param fromKey - The source issue key
   * @param toKey - The target issue key
   * @param linkType - The type of dependency relationship
   */
  linkDependency(fromKey: string, toKey: string, linkType: DependencyLinkType): Promise<void>;

  // ── Sprint Operations ───────────────────────────────────────────────────

  /**
   * Move issues into a sprint/iteration.
   * @param issueKeys - Issue keys to move
   * @param sprintId - Target sprint ID
   */
  moveToSprint(issueKeys: string[], sprintId: string): Promise<void>;

  /**
   * Get the active sprint for the configured project/board.
   * @returns The active sprint, or null if none exists
   */
  getActiveSprint(): Promise<ExternalSprint | null>;
}

// ── Source Code Management Connector ────────────────────────────────────────

/**
 * Interface for source code management integrations (GitHub, GitLab, Bitbucket, etc.).
 *
 * Implementations wrap a specific provider's API for pull/merge request management
 * and related repository operations.
 */
export interface SCMConnector {
  /** Unique identifier for this connector type (e.g., "github", "gitlab") */
  readonly type: string;

  /** Human-readable provider name (e.g., "GitHub", "GitLab") */
  readonly displayName: string;

  /**
   * Check if the SCM provider is authenticated and ready for operations.
   * @returns true if authenticated
   */
  isAuthenticated(): Promise<boolean>;

  // ── Pull Request Operations ─────────────────────────────────────────────

  /**
   * Create a new pull/merge request.
   * @param workDir - Working directory for the repository
   * @param input - PR creation data
   * @returns The created PR reference
   */
  createPR(workDir: string, input: CreatePRInput): Promise<CreatePRResult>;

  /**
   * Fetch a pull request by its number.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   * @returns The fetched PR data
   */
  fetchPR(workDir: string, prNumber: number): Promise<ExternalPullRequest>;

  /**
   * List pull requests by state.
   * @param workDir - Working directory for the repository
   * @param state - Filter by PR state
   * @returns List of matching PRs
   */
  listPRs(
    workDir: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<ExternalPullRequest[]>;

  /**
   * Merge a pull request.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   * @param options - Merge options (strategy, branch deletion)
   */
  mergePR(workDir: string, prNumber: number, options?: MergePROptions): Promise<void>;

  /**
   * Close a pull request without merging.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   */
  closePR(workDir: string, prNumber: number): Promise<void>;

  // ── Review Operations ───────────────────────────────────────────────────

  /**
   * Add a reviewer to a pull request.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   * @param reviewer - Reviewer username/identifier
   */
  addReviewer(workDir: string, prNumber: number, reviewer: string): Promise<void>;

  /**
   * Get reviews on a pull request.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   * @returns List of reviews
   */
  getReviews(workDir: string, prNumber: number): Promise<ExternalPRReview[]>;

  // ── Comments ────────────────────────────────────────────────────────────

  /**
   * Post a comment on a pull request.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   * @param body - Comment body text
   */
  commentOnPR(workDir: string, prNumber: number, body: string): Promise<void>;

  /**
   * Get the diff for a pull request.
   * @param workDir - Working directory for the repository
   * @param prNumber - The PR number
   * @returns The unified diff as a string
   */
  getPRDiff(workDir: string, prNumber: number): Promise<string>;
}
