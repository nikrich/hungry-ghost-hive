// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it, vi } from 'vitest';
import {
  getActiveSprint,
  getActiveSprintForProject,
  getBoardsForProject,
  moveIssuesToSprint,
} from './sprints.js';
import type { JiraBoard, JiraSprint } from './types.js';

/** Create a minimal mock JiraClient */
function createMockClient(requestFn: (...args: any[]) => any) {
  return {
    getBaseUrl: () => 'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3',
    getAgileBaseUrl: () => 'https://api.atlassian.com/ex/jira/cloud-1/rest/agile/1.0',
    request: vi.fn(requestFn),
  } as any;
}

const sampleBoard: JiraBoard = {
  id: 1,
  name: 'PROJ board',
  type: 'scrum',
  self: 'https://example.com/board/1',
};

const sampleSprint: JiraSprint = {
  id: 42,
  name: 'Sprint 5',
  state: 'active',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-01-14T00:00:00.000Z',
  self: 'https://example.com/sprint/42',
};

describe('getBoardsForProject', () => {
  it('should return boards for a project', async () => {
    const client = createMockClient(async () => ({
      values: [sampleBoard],
      startAt: 0,
      maxResults: 50,
      total: 1,
      isLast: true,
    }));

    const boards = await getBoardsForProject(client, 'PROJ');
    expect(boards).toHaveLength(1);
    expect(boards[0].id).toBe(1);
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('board?projectKeyOrId=PROJ')
    );
  });

  it('should return empty array when no boards exist', async () => {
    const client = createMockClient(async () => ({
      values: [],
      startAt: 0,
      maxResults: 50,
      total: 0,
      isLast: true,
    }));

    const boards = await getBoardsForProject(client, 'EMPTY');
    expect(boards).toHaveLength(0);
  });
});

describe('getActiveSprint', () => {
  it('should return active sprint for a board', async () => {
    const client = createMockClient(async () => ({
      values: [sampleSprint],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));

    const sprint = await getActiveSprint(client, 1);
    expect(sprint).not.toBeNull();
    expect(sprint!.id).toBe(42);
    expect(sprint!.state).toBe('active');
  });

  it('should return null when no active sprint', async () => {
    const client = createMockClient(async () => ({
      values: [],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));

    const sprint = await getActiveSprint(client, 1);
    expect(sprint).toBeNull();
  });

  it('should return null for kanban boards (API error)', async () => {
    const client = createMockClient(async () => {
      throw new Error('The board does not support sprints');
    });

    const sprint = await getActiveSprint(client, 99);
    expect(sprint).toBeNull();
  });
});

describe('moveIssuesToSprint', () => {
  it('should POST issues to the sprint endpoint', async () => {
    const client = createMockClient(async () => undefined);

    await moveIssuesToSprint(client, 42, ['PROJ-1', 'PROJ-2']);

    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('/sprint/42/issue'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ issues: ['PROJ-1', 'PROJ-2'] }),
      })
    );
  });

  it('should do nothing when given empty issue list', async () => {
    const client = createMockClient(async () => undefined);

    await moveIssuesToSprint(client, 42, []);
    expect(client.request).not.toHaveBeenCalled();
  });
});

describe('getActiveSprintForProject', () => {
  it('should find active sprint across boards', async () => {
    const kanbanBoard: JiraBoard = {
      id: 2,
      name: 'Kanban',
      type: 'kanban',
      self: 'https://example.com/board/2',
    };

    const client = createMockClient(async (url: string) => {
      if (url.includes('board?projectKeyOrId=')) {
        return {
          values: [kanbanBoard, sampleBoard],
          startAt: 0,
          maxResults: 50,
          total: 2,
          isLast: true,
        };
      }
      if (url.includes(`/board/2/sprint`)) {
        throw new Error('Kanban boards do not support sprints');
      }
      if (url.includes(`/board/1/sprint`)) {
        return { values: [sampleSprint], startAt: 0, maxResults: 50, isLast: true };
      }
      return { values: [], startAt: 0, maxResults: 50, isLast: true };
    });

    const result = await getActiveSprintForProject(client, 'PROJ');
    expect(result).not.toBeNull();
    expect(result!.sprint.id).toBe(42);
    expect(result!.boardId).toBe(1);
  });

  it('should return null when no boards have active sprints', async () => {
    const client = createMockClient(async (url: string) => {
      if (url.includes('board?projectKeyOrId=')) {
        return { values: [sampleBoard], startAt: 0, maxResults: 50, total: 1, isLast: true };
      }
      return { values: [], startAt: 0, maxResults: 50, isLast: true };
    });

    const result = await getActiveSprintForProject(client, 'PROJ');
    expect(result).toBeNull();
  });

  it('should return null when project has no boards', async () => {
    const client = createMockClient(async () => ({
      values: [],
      startAt: 0,
      maxResults: 50,
      total: 0,
      isLast: true,
    }));

    const result = await getActiveSprintForProject(client, 'EMPTY');
    expect(result).toBeNull();
  });
});
