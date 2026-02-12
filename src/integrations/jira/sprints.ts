// Licensed under the Hungry Ghost Hive License. See LICENSE.

import * as logger from '../../utils/logger.js';
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

/** Sprint field ID used by Jira (customfield_10020 is the standard greenhopper sprint field) */
const SPRINT_CUSTOM_FIELD = 'customfield_10020';

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
  const url = `${client.getAgileBaseUrl()}/board/${boardId}/sprint?state=active,future`;
  try {
    const response = await client.request<SprintListResponse>(url);
    return response.values.length > 0 ? response.values[0] : null;
  } catch {
    // Kanban boards don't support sprints — return null gracefully
    return null;
  }
}

/**
 * Move issues into a sprint via the Agile API.
 * Falls back to setting the sprint custom field via REST API v3
 * if the Agile API is not authorized (missing Jira Software scopes).
 */
export async function moveIssuesToSprint(
  client: JiraClient,
  sprintId: number,
  issueKeys: string[]
): Promise<void> {
  if (issueKeys.length === 0) return;

  try {
    const url = `${client.getAgileBaseUrl()}/sprint/${sprintId}/issue`;
    await client.request<void>(url, {
      method: 'POST',
      body: JSON.stringify({ issues: issueKeys }),
    });
  } catch {
    // Fallback: set sprint via the custom field on each issue (REST API v3)
    logger.info(
      'Agile API sprint assignment failed, falling back to REST API v3 custom field update'
    );
    for (const key of issueKeys) {
      try {
        await client.request<void>(`/issue/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ fields: { [SPRINT_CUSTOM_FIELD]: sprintId } }),
        });
      } catch (fieldErr) {
        // Subtasks may not support sprint field directly — they inherit from parent
        logger.debug(`Could not set sprint on ${key} (may be a subtask): ${fieldErr}`);
      }
    }
  }
}

/**
 * Find the active sprint for a project by discovering its boards.
 * Tries each board until an active sprint is found.
 *
 * If the Agile API is not authorized, falls back to reading the sprint
 * custom field from an existing issue in the project.
 *
 * Returns null if the project has no active sprint.
 */
export async function getActiveSprintForProject(
  client: JiraClient,
  projectKey: string,
  preferredBoardId?: number
): Promise<{ sprint: JiraSprint; boardId: number } | null> {
  try {
    const boards = await getBoardsForProject(client, projectKey);

    // Try the preferred board first if specified
    const sortedBoards = preferredBoardId
      ? [...boards].sort((a, b) => (a.id === preferredBoardId ? -1 : b.id === preferredBoardId ? 1 : 0))
      : boards;

    for (const board of sortedBoards) {
      const sprint = await getActiveSprint(client, board.id);
      if (sprint) {
        return { sprint, boardId: board.id };
      }
    }

    return null;
  } catch {
    // Agile API not authorized — try REST API v3 fallback
    logger.info('Agile API not available, falling back to sprint field discovery via REST API v3');
    return getActiveSprintViaRestApi(client, projectKey, preferredBoardId);
  }
}

/**
 * Fallback: discover the active/future sprint by reading the sprint custom field
 * from issues in the project, or by querying JQL for sprint-assigned issues.
 */
async function getActiveSprintViaRestApi(
  client: JiraClient,
  projectKey: string,
  preferredBoardId?: number
): Promise<{ sprint: JiraSprint; boardId: number } | null> {
  try {
    const { searchJql } = await import('./issues.js');
    const result = await searchJql(
      client,
      `project = ${projectKey} AND (sprint in openSprints() OR sprint in futureSprints())`,
      { maxResults: 20, fields: [SPRINT_CUSTOM_FIELD] }
    );

    // Collect all unique sprints, preferring ones on the configured board
    type SprintInfo = { id: number; name: string; state: string; boardId: number };
    const sprints = new Map<number, SprintInfo>();

    for (const issue of result.issues) {
      const field = issue.fields[SPRINT_CUSTOM_FIELD] as SprintInfo[] | null;
      if (!field) continue;
      for (const s of field) {
        if (!sprints.has(s.id)) {
          sprints.set(s.id, s);
        }
      }
    }

    // Prefer active over future, and preferred board over others
    const sorted = [...sprints.values()].sort((a, b) => {
      // Preferred board first
      if (preferredBoardId) {
        if (a.boardId === preferredBoardId && b.boardId !== preferredBoardId) return -1;
        if (b.boardId === preferredBoardId && a.boardId !== preferredBoardId) return 1;
      }
      // Active before future
      if (a.state === 'active' && b.state !== 'active') return -1;
      if (b.state === 'active' && a.state !== 'active') return 1;
      return 0;
    });

    if (sorted.length > 0) {
      const s = sorted[0];
      return {
        sprint: {
          id: s.id,
          name: s.name,
          state: s.state as 'active' | 'closed' | 'future',
          self: '',
        },
        boardId: s.boardId ?? 0,
      };
    }
  } catch {
    // JQL sprint functions may not work — return null
  }

  return null;
}
