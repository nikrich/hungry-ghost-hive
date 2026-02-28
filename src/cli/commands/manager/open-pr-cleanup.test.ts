// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { run } from '../../../db/client.js';
import {
  createPullRequest,
  getPullRequestById,
  updatePullRequest,
} from '../../../db/queries/pull-requests.js';
import { createTestDatabase } from '../../../db/queries/test-helpers.js';
import { closeOpenPRsForMergedStories } from './open-pr-cleanup.js';

function insertStoryRow(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
  input: {
    id: string;
    status: string;
  }
): void {
  const now = new Date().toISOString();
  run(
    db,
    `
      INSERT INTO stories (id, title, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [input.id, `title-${input.id}`, `description-${input.id}`, input.status, now, now]
  );
}

describe('closeOpenPRsForMergedStories', () => {
  it('closes queued/reviewing PR rows linked to merged stories', async () => {
    const db = await createTestDatabase();

    insertStoryRow(db, { id: 'STORY-MERGED', status: 'merged' });
    insertStoryRow(db, { id: 'STORY-IN-PROGRESS', status: 'in_progress' });

    const staleQueued = createPullRequest(db, {
      storyId: 'STORY-MERGED',
      branchName: 'feature/STORY-MERGED-a',
    });
    const staleReviewing = createPullRequest(db, {
      storyId: 'STORY-MERGED',
      branchName: 'feature/STORY-MERGED-b',
      githubPrNumber: 101,
    });
    updatePullRequest(db, staleReviewing.id, { status: 'reviewing' });

    const activeReviewing = createPullRequest(db, {
      storyId: 'STORY-IN-PROGRESS',
      branchName: 'feature/STORY-IN-PROGRESS',
      githubPrNumber: 202,
    });
    updatePullRequest(db, activeReviewing.id, { status: 'reviewing' });

    const closed = closeOpenPRsForMergedStories(db);

    expect(closed).toHaveLength(2);
    expect(closed.map(entry => entry.prId).sort()).toEqual([staleQueued.id, staleReviewing.id].sort());
    expect(getPullRequestById(db, staleQueued.id)?.status).toBe('closed');
    expect(getPullRequestById(db, staleReviewing.id)?.status).toBe('closed');
    expect(getPullRequestById(db, activeReviewing.id)?.status).toBe('reviewing');

    db.close();
  });

  it('is a no-op when no open PR rows reference merged stories', async () => {
    const db = await createTestDatabase();

    insertStoryRow(db, { id: 'STORY-IN-PROGRESS', status: 'in_progress' });
    const activeQueued = createPullRequest(db, {
      storyId: 'STORY-IN-PROGRESS',
      branchName: 'feature/STORY-IN-PROGRESS',
    });

    const closed = closeOpenPRsForMergedStories(db);

    expect(closed).toEqual([]);
    expect(getPullRequestById(db, activeQueued.id)?.status).toBe('queued');

    db.close();
  });
});
