// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { autoAssignPlannedStories } from './auto-assignment.js';

vi.mock('../../../db/client.js', () => ({
  queryAll: vi.fn(),
}));

import { queryAll } from '../../../db/client.js';

describe('autoAssignPlannedStories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCtx(options?: {
    plannedUnassigned?: number;
    assigned?: number;
    errors?: string[];
    verbose?: boolean;
  }) {
    const checkScaling = vi.fn().mockResolvedValue(undefined);
    const checkMergeQueue = vi.fn().mockResolvedValue(undefined);
    const assignStories = vi.fn().mockResolvedValue({
      assigned: options?.assigned ?? 0,
      errors: options?.errors ?? [],
      preventedDuplicates: 0,
    });
    const save = vi.fn();
    const mockDb = { db: {} as never, save };
    const scheduler = { checkScaling, checkMergeQueue, assignStories } as never;

    let callCount = 0;
    const withDb = vi.fn(async (fn: (db: typeof mockDb, scheduler: any) => unknown) => {
      callCount += 1;
      vi.mocked(queryAll).mockReturnValueOnce([{ count: options?.plannedUnassigned ?? 0 }] as never);
      return fn(mockDb, scheduler);
    });

    const ctx = {
      verbose: options?.verbose ?? false,
      withDb,
      counters: {
        plannedAutoAssigned: 0,
      },
    } as any;

    return { ctx, withDb, checkScaling, checkMergeQueue, assignStories, save, getCallCount: () => callCount };
  }

  it('skips assignment when there are no planned unassigned stories', async () => {
    const { ctx, checkScaling, checkMergeQueue, assignStories, withDb } = makeCtx({
      plannedUnassigned: 0,
    });

    await autoAssignPlannedStories(ctx);

    expect(withDb).toHaveBeenCalledTimes(1);
    expect(checkScaling).not.toHaveBeenCalled();
    expect(checkMergeQueue).not.toHaveBeenCalled();
    expect(assignStories).not.toHaveBeenCalled();
    expect(ctx.counters.plannedAutoAssigned).toBe(0);
  });

  it('runs scaling, merge queue check, and assignment when planned stories exist', async () => {
    const { ctx, checkScaling, checkMergeQueue, assignStories, withDb } = makeCtx({
      plannedUnassigned: 2,
      assigned: 1,
    });

    await autoAssignPlannedStories(ctx);

    expect(withDb).toHaveBeenCalledTimes(2);
    expect(checkScaling).toHaveBeenCalledTimes(1);
    expect(checkMergeQueue).toHaveBeenCalledTimes(1);
    expect(assignStories).toHaveBeenCalledTimes(1);
    expect(ctx.counters.plannedAutoAssigned).toBe(1);
  });
});
