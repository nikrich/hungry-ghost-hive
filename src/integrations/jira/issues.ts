// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { JiraClient } from './client.js';
import type {
  CreateIssueLinkRequest,
  CreateIssueRequest,
  CreateIssueResponse,
  JiraIssue,
  JiraSearchResponse,
  JiraTransitionsResponse,
  TransitionIssueRequest,
  UpdateIssueRequest,
} from './types.js';

/**
 * Create a new Jira issue.
 */
export async function createIssue(
  client: JiraClient,
  request: CreateIssueRequest
): Promise<CreateIssueResponse> {
  return client.request<CreateIssueResponse>('/issue', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Update an existing Jira issue by key or ID.
 */
export async function updateIssue(
  client: JiraClient,
  issueIdOrKey: string,
  request: UpdateIssueRequest
): Promise<void> {
  await client.request<void>(`/issue/${encodeURIComponent(issueIdOrKey)}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
}

/**
 * Fetch a Jira issue by key or ID.
 */
export async function getIssue(
  client: JiraClient,
  issueIdOrKey: string,
  fields?: string[]
): Promise<JiraIssue> {
  const params = new URLSearchParams();
  if (fields && fields.length > 0) {
    params.set('fields', fields.join(','));
  }
  const query = params.toString();
  const path = `/issue/${encodeURIComponent(issueIdOrKey)}${query ? `?${query}` : ''}`;
  return client.request<JiraIssue>(path);
}

/**
 * Transition a Jira issue to a new status.
 * Callers should first fetch available transitions via getTransitions().
 */
export async function transitionIssue(
  client: JiraClient,
  issueIdOrKey: string,
  request: TransitionIssueRequest
): Promise<void> {
  await client.request<void>(`/issue/${encodeURIComponent(issueIdOrKey)}/transitions`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Get available transitions for an issue.
 */
export async function getTransitions(
  client: JiraClient,
  issueIdOrKey: string
): Promise<JiraTransitionsResponse> {
  return client.request<JiraTransitionsResponse>(
    `/issue/${encodeURIComponent(issueIdOrKey)}/transitions`
  );
}

/**
 * Search for issues using JQL (Jira Query Language).
 */
export async function searchJql(
  client: JiraClient,
  jql: string,
  options?: { startAt?: number; maxResults?: number; fields?: string[] }
): Promise<JiraSearchResponse> {
  return client.request<JiraSearchResponse>('/search', {
    method: 'POST',
    body: JSON.stringify({
      jql,
      startAt: options?.startAt ?? 0,
      maxResults: options?.maxResults ?? 50,
      fields: options?.fields ?? ['summary', 'status', 'issuetype', 'assignee', 'labels', 'priority', 'parent', 'project'],
    }),
  });
}

/**
 * Create a link between two Jira issues (e.g., "is blocked by").
 */
export async function createIssueLink(
  client: JiraClient,
  request: CreateIssueLinkRequest
): Promise<void> {
  await client.request<void>('/issueLink', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
