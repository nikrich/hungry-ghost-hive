// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getReadOnlyDatabase } from '../../db/client.js';
import { getActiveAgents, getAgentById } from '../../db/queries/agents.js';
import { getLogsByAgent } from '../../db/queries/logs.js';
import { getAllTeams } from '../../db/queries/teams.js';
import type { Router } from '../router.js';
import { sendJson } from '../server.js';

export function registerAgentRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/agents', async (_req, res) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const agents = getActiveAgents(db.db);
      const teams = getAllTeams(db.db);
      const teamMap = new Map(teams.map(t => [t.id, t]));
      const result = agents.map(a => ({
        ...a,
        team: a.team_id ? teamMap.get(a.team_id) || null : null,
      }));
      sendJson(res, 200, result);
    } finally {
      db.close();
    }
  });

  router.get('/api/v1/agents/:id', async (_req, res, params) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const agent = getAgentById(db.db, params.id);
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' });
        return;
      }
      const logs = getLogsByAgent(db.db, params.id, 50);
      sendJson(res, 200, { ...agent, logs });
    } finally {
      db.close();
    }
  });
}
