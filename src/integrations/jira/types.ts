// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * TypeScript types for Jira REST API v3 responses.
 * Covers issues, transitions, comments, projects, boards, and related entities.
 */

// ── User ────────────────────────────────────────────────────────────────────

/** Jira user (Atlassian account) */
export interface JiraUser {
  accountId: string;
  emailAddress?: string;
  displayName: string;
  active: boolean;
  avatarUrls?: Record<string, string>;
  self?: string;
}

// ── ADF (Atlassian Document Format) ─────────────────────────────────────────

/** A node within an Atlassian Document Format document */
export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
}

/** Inline mark applied to ADF text nodes */
export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** Top-level Atlassian Document Format document */
export interface AdfDocument {
  version: 1;
  type: 'doc';
  content: AdfNode[];
}

// ── Issue Status / Priority / Type ──────────────────────────────────────────

/** Jira issue status */
export interface JiraStatus {
  id: string;
  name: string;
  statusCategory: {
    id: number;
    key: string;
    name: string;
  };
  self?: string;
}

/** Jira issue priority */
export interface JiraPriority {
  id: string;
  name: string;
  iconUrl?: string;
  self?: string;
}

/** Jira issue type (e.g., Story, Bug, Epic, Subtask) */
export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
  description?: string;
  iconUrl?: string;
  self?: string;
}

// ── Issue ───────────────────────────────────────────────────────────────────

/** Jira issue fields as returned by the API */
export interface JiraIssueFields {
  summary: string;
  description?: AdfDocument | null;
  status: JiraStatus;
  priority?: JiraPriority;
  issuetype: JiraIssueType;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  labels: string[];
  created: string;
  updated: string;
  parent?: { id: string; key: string; self?: string };
  project: { id: string; key: string; name: string; self?: string };
  /** Story points (custom field — key varies by instance) */
  story_points?: number | null;
  [key: string]: unknown;
}

/** A Jira issue */
export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

// ── Transition ──────────────────────────────────────────────────────────────

/** A workflow transition available for an issue */
export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  hasScreen?: boolean;
  isGlobal?: boolean;
  isInitial?: boolean;
  isConditional?: boolean;
}

/** Response from GET /rest/api/3/issue/{id}/transitions */
export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

// ── Comment ─────────────────────────────────────────────────────────────────

/** A comment on a Jira issue */
export interface JiraComment {
  id: string;
  self: string;
  author: JiraUser;
  body: AdfDocument;
  created: string;
  updated: string;
}

// ── Project ─────────────────────────────────────────────────────────────────

/** A Jira project */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  style?: string;
  self: string;
  avatarUrls?: Record<string, string>;
}

// ── Board ───────────────────────────────────────────────────────────────────

/** A Jira board (Agile) */
export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  self: string;
  location?: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

// ── Sprint ──────────────────────────────────────────────────────────────────

/** A Jira sprint */
export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  self: string;
}

// ── Issue Link ──────────────────────────────────────────────────────────────

/** Type of link between issues */
export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
  self?: string;
}

/** A link between two Jira issues */
export interface JiraIssueLink {
  id: string;
  type: JiraIssueLinkType;
  inwardIssue?: { id: string; key: string; self: string };
  outwardIssue?: { id: string; key: string; self: string };
  self?: string;
}

// ── Search ──────────────────────────────────────────────────────────────────

/** Response from POST /rest/api/3/search */
export interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

// ── Request payloads ────────────────────────────────────────────────────────

/** Payload for creating a Jira issue */
export interface CreateIssueRequest {
  fields: {
    project: { key: string };
    summary: string;
    issuetype: { name: string };
    description?: AdfDocument;
    labels?: string[];
    parent?: { key: string };
    priority?: { name: string };
    assignee?: { accountId: string };
    [key: string]: unknown;
  };
}

/** Payload for updating a Jira issue */
export interface UpdateIssueRequest {
  fields?: Record<string, unknown>;
  update?: Record<string, Array<Record<string, unknown>>>;
}

/** Payload for transitioning a Jira issue */
export interface TransitionIssueRequest {
  transition: { id: string };
  fields?: Record<string, unknown>;
}

/** Payload for creating a link between issues */
export interface CreateIssueLinkRequest {
  type: { name: string };
  inwardIssue: { key: string };
  outwardIssue: { key: string };
}

// ── API response wrappers ───────────────────────────────────────────────────

/** Response from creating an issue */
export interface CreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

/** Paginated list of projects */
export interface JiraProjectListResponse {
  values: JiraProject[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}

/** Paginated list of boards */
export interface JiraBoardListResponse {
  values: JiraBoard[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}
