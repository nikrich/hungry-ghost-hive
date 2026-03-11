// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getReadOnlyDatabase } from '../../db/client.js';
import { getStoryCounts } from '../../db/queries/stories.js';
import type { Router } from '../router.js';
import { sendJson } from '../server.js';

export function registerPipelineRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/pipeline', async (_req, res) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const counts = getStoryCounts(db.db);
      sendJson(res, 200, counts);
    } finally {
      db.close();
    }
  });
}
