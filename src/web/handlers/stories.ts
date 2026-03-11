// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getReadOnlyDatabase } from '../../db/client.js';
import { getLogsByStory } from '../../db/queries/logs.js';
import {
  getAllStories,
  getStoriesByStatus,
  getStoriesDependingOn,
  getStoryById,
  getStoryDependencies,
  type StoryStatus,
} from '../../db/queries/stories.js';
import type { Router } from '../router.js';
import { sendJson } from '../server.js';

const VALID_STATUSES = new Set([
  'draft',
  'estimated',
  'planned',
  'in_progress',
  'review',
  'qa',
  'qa_failed',
  'pr_submitted',
  'merged',
]);

export function registerStoryRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/stories', async (_req, res, _params, query) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      let stories;
      if (query.status && VALID_STATUSES.has(query.status)) {
        stories = getStoriesByStatus(db.db, query.status as StoryStatus);
      } else {
        stories = getAllStories(db.db);
      }
      sendJson(res, 200, stories);
    } finally {
      db.close();
    }
  });

  router.get('/api/v1/stories/:id', async (_req, res, params) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const story = getStoryById(db.db, params.id);
      if (!story) {
        sendJson(res, 404, { error: 'Story not found' });
        return;
      }
      const dependencies = getStoryDependencies(db.db, params.id);
      const dependents = getStoriesDependingOn(db.db, params.id);
      const logs = getLogsByStory(db.db, params.id);
      sendJson(res, 200, { ...story, dependencies, dependents, logs });
    } finally {
      db.close();
    }
  });
}
