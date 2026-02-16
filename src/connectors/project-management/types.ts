// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type {
  ConnectorCommentContext,
  ConnectorCreateSubtaskOptions,
  ConnectorEpic,
  ConnectorIssue,
  ConnectorLifecycleEvent,
  ConnectorParsedEpicUrl,
  ConnectorSignOffReportData,
  ConnectorSubtaskResult,
  CreateEpicOptions,
  CreateStoryOptions,
  SearchIssuesOptions,
} from '../common-types.js';

/**
 * Provider-agnostic interface for project management operations.
 *
 * Implementations wrap provider-specific APIs (Jira, Linear, Monday, etc.)
 * behind a uniform contract so the orchestrator never imports provider code directly.
 */
export interface IProjectManagementConnector {
  /** The provider identifier (e.g., "jira", "linear", "monday") */
  readonly provider: string;

  /**
   * Fetch an epic by its issue key or URL.
   * @param issueKeyOrUrl - Issue key (e.g., "HIVE-2") or a full URL
   */
  fetchEpic(issueKeyOrUrl: string): Promise<ConnectorEpic>;

  /**
   * Create a new epic in the project management tool.
   * @param options - Epic creation parameters
   */
  createEpic(options: CreateEpicOptions): Promise<{ key: string; id: string }>;

  /**
   * Create a new story/issue in the project management tool.
   * @param options - Story creation parameters
   */
  createStory(options: CreateStoryOptions): Promise<{ key: string; id: string }>;

  /**
   * Transition a story/issue to a new status.
   * @param issueKeyOrId - Issue key or ID
   * @param targetStatus - The target Hive status to map to the provider's status
   * @param statusMapping - Mapping from provider status names to Hive status names
   * @returns true if the transition was applied, false if skipped
   */
  transitionStory(
    issueKeyOrId: string,
    targetStatus: string,
    statusMapping: Record<string, string>
  ): Promise<boolean>;

  /**
   * Search for issues using a provider-specific query.
   * @param query - Query string (e.g., JQL for Jira, filter syntax for Linear)
   * @param options - Search options
   */
  searchIssues(query: string, options?: SearchIssuesOptions): Promise<ConnectorIssue[]>;

  /**
   * Fetch a single issue by key or ID.
   * @param issueKeyOrId - Issue key or ID
   */
  getIssue(issueKeyOrId: string): Promise<ConnectorIssue>;

  /**
   * Sync status changes between the provider and Hive.
   * @param issueKeyOrId - Issue key or ID
   * @param hiveStatus - The current Hive status to push to the provider
   * @param statusMapping - Mapping from provider status names to Hive status names
   * @returns true if the sync resulted in a status change
   */
  syncStatus(
    issueKeyOrId: string,
    hiveStatus: string,
    statusMapping: Record<string, string>
  ): Promise<boolean>;

  /**
   * Post a lifecycle event comment to an issue.
   * @param issueKey - Issue key to comment on
   * @param event - Lifecycle event type
   * @param context - Additional context for the comment
   * @returns true if successful, false otherwise
   */
  postComment(
    issueKey: string,
    event: ConnectorLifecycleEvent,
    context?: ConnectorCommentContext
  ): Promise<boolean>;

  /**
   * Create a subtask under a parent issue.
   * @param options - Subtask creation options
   * @returns Created subtask result, or null if failed
   */
  createSubtask(options: ConnectorCreateSubtaskOptions): Promise<ConnectorSubtaskResult | null>;

  /**
   * Transition a subtask to a target status.
   * @param subtaskKey - Subtask key to transition
   * @param targetStatus - Target status name
   * @returns true if the transition was applied, false if skipped
   */
  transitionSubtask(subtaskKey: string, targetStatus: string): Promise<boolean>;

  /**
   * Post a feature sign-off report as a comment on an epic.
   * @param epicKey - Epic issue key to comment on
   * @param data - Sign-off report data
   * @returns true if successful, false otherwise
   */
  postSignOffReport(epicKey: string, data: ConnectorSignOffReportData): Promise<boolean>;

  /**
   * Check whether a string looks like an epic URL for this provider.
   * @param value - String to check (may be a URL or issue key)
   */
  isEpicUrl(value: string): boolean;

  /**
   * Parse a provider-specific epic URL and extract structured data.
   * @param url - The URL to parse
   * @returns Parsed URL data, or null if the URL doesn't match this provider
   */
  parseEpicUrl(url: string): ConnectorParsedEpicUrl | null;
}
