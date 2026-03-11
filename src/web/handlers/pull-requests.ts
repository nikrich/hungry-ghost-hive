// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getReadOnlyDatabase } from '../../db/client.js';
import { getAllPullRequests, getPrioritizedMergeQueue } from '../../db/queries/pull-requests.js';
import type { Router } from '../router.js';
import { sendJson } from '../server.js';

export function registerPullRequestRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/pull-requests', async (_req, res) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const prs = getAllPullRequests(db.db);
      sendJson(res, 200, prs);
    } finally {
      db.close();
    }
  });

  router.get('/api/v1/merge-queue', async (_req, res) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const queue = getPrioritizedMergeQueue(db.db);
      sendJson(res, 200, queue);
    } finally {
      db.close();
    }
  });
}
