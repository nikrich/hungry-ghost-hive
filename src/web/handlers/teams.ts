// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getReadOnlyDatabase } from '../../db/client.js';
import { getAllTeams } from '../../db/queries/teams.js';
import type { Router } from '../router.js';
import { sendJson } from '../server.js';

export function registerTeamRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/teams', async (_req, res) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const teams = getAllTeams(db.db);
      sendJson(res, 200, teams);
    } finally {
      db.close();
    }
  });
}
