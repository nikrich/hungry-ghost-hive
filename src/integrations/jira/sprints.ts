// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { JiraClient } from './client.js';
import type { JiraBoard, JiraSprint } from './types.js';

/** Paginated board list response from Agile API */
interface BoardListResponse {
  values: JiraBoard[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}

/** Paginated sprint list response from Agile API */
interface SprintListResponse {
  values: JiraSprint[];
  startAt: number;
  maxResults: number;
  isLast: boolean;
}

/**
 * Get all boards for a project via the Jira Agile API.
 */
export async function getBoardsForProject(
  client: JiraClient,
  projectKey: string
): Promise<JiraBoard[]> {
  const url = `${client.getAgileBaseUrl()}/board?projectKeyOrId=${encodeURIComponent(projectKey)}`;
  const response = await client.request<BoardListResponse>(url);
  return response.values;
}

/**
 * Get the active sprint for a specific board.
 * Returns null if the board has no active sprint (e.g., kanban boards).
 */
export async function getActiveSprint(
  client: JiraClient,
  boardId: string | number
): Promise<JiraSprint | null> {
  const url = `${client.getAgileBaseUrl()}/board/${boardId}/sprint?state=active`;
  try {
    const response = await client.request<SprintListResponse>(url);
    return response.values.length > 0 ? response.values[0] : null;
  } catch {
    // Kanban boards don't support sprints — return null gracefully
    return null;
  }
}

/**
 * Move issues into a sprint.
 */
export async function moveIssuesToSprint(
  client: JiraClient,
  sprintId: number,
  issueKeys: string[]
): Promise<void> {
  if (issueKeys.length === 0) return;

  const url = `${client.getAgileBaseUrl()}/sprint/${sprintId}/issue`;
  await client.request<void>(url, {
    method: 'POST',
    body: JSON.stringify({ issues: issueKeys }),
  });
}

/**
 * Find the active sprint for a project by discovering its boards.
 * Tries each board until an active sprint is found.
 * Returns null if the project has no active sprint (all kanban, or no boards).
 */
export async function getActiveSprintForProject(
  client: JiraClient,
  projectKey: string
): Promise<{ sprint: JiraSprint; boardId: number } | null> {
  const boards = await getBoardsForProject(client, projectKey);

  for (const board of boards) {
    const sprint = await getActiveSprint(client, board.id);
    if (sprint) {
      return { sprint, boardId: board.id };
    }
  }

  return null;
}
