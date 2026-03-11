// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getReadOnlyDatabase } from '../../db/client.js';
import { getLogsSince, getRecentLogs } from '../../db/queries/logs.js';
import type { Router } from '../router.js';
import { sendJson } from '../server.js';

export function registerLogRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/logs', async (_req, res, _params, query) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      let logs;
      if (query.since) {
        logs = getLogsSince(db.db, query.since);
      } else {
        const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 500);
        logs = getRecentLogs(db.db, limit);
      }
      sendJson(res, 200, logs);
    } finally {
      db.close();
    }
  });
}
