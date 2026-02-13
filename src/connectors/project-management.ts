// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type {
  ConnectorConfig,
  ConnectorEpic,
  ConnectorIssue,
  ParsedUrl,
  SearchOpts,
  SubtaskData,
} from './types.js';

/**
 * Provider-agnostic interface for project management integrations
 * (Jira, Monday, Linear, etc.).
 *
 * Each provider implements this interface, mapping its own API to the
 * generic connector types defined in `types.ts`.
 */
export interface ProjectManagementConnector {
  /** Provider identifier (e.g., 'jira', 'monday', 'linear') */
  readonly name: string;

  /** Initialize authentication using provider-specific config */
  authenticate(config: ConnectorConfig): Promise<void>;

  /** Fetch a single issue by its key or ID */
  fetchIssue(key: string): Promise<ConnectorIssue>;

  /** Search for issues using a provider-specific query (e.g., JQL for Jira) */
  searchIssues(query: string, opts?: SearchOpts): Promise<ConnectorIssue[]>;

  /** Create a subtask under the given parent issue */
  createSubtask(parentKey: string, data: SubtaskData): Promise<ConnectorIssue>;

  /** Post a comment on an issue */
  postComment(issueKey: string, comment: string): Promise<void>;

  /** Transition an issue to a new status */
  transitionStatus(issueKey: string, status: string): Promise<void>;

  /** Fetch an epic by its key or URL, returning structured data for requirement creation */
  fetchEpic(keyOrUrl: string): Promise<ConnectorEpic>;

  /** Check whether a URL belongs to this provider */
  isValidUrl(url: string): boolean;

  /** Parse a provider URL and extract the issue key and site URL */
  parseUrl(url: string): ParsedUrl | null;
}
