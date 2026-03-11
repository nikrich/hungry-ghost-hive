// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import { getDatabase, getReadOnlyDatabase } from '../../db/client.js';
import { acquireLock } from '../../db/lock.js';
import {
  createRequirement,
  getAllRequirements,
  getRequirementById,
} from '../../db/queries/requirements.js';
import { getStoriesByRequirement } from '../../db/queries/stories.js';
import type { Router } from '../router.js';
import { readJsonBody, sendJson } from '../server.js';

export function registerRequirementRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/requirements', async (_req, res) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const requirements = getAllRequirements(db.db);
      sendJson(res, 200, requirements);
    } finally {
      db.close();
    }
  });

  router.get('/api/v1/requirements/:id', async (_req, res, params) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const req = getRequirementById(db.db, params.id);
      if (!req) {
        sendJson(res, 404, { error: 'Requirement not found' });
        return;
      }
      const stories = getStoriesByRequirement(db.db, params.id);
      sendJson(res, 200, { ...req, stories });
    } finally {
      db.close();
    }
  });

  router.post('/api/v1/requirements', async (req, res) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!title || !description) {
      sendJson(res, 400, { error: 'title and description are required' });
      return;
    }

    const dbLockPath = join(hiveDir, 'db');
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      releaseLock = await acquireLock(dbLockPath, {
        stale: 30000,
        retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
      });
      const db = await getDatabase(hiveDir);
      try {
        const requirement = createRequirement(db.db, {
          title,
          description,
          godmode: body.godmode === true,
          targetBranch: typeof body.target_branch === 'string' ? body.target_branch : undefined,
          submittedBy: 'web-dashboard',
        });
        db.save();
        sendJson(res, 201, requirement);
      } finally {
        db.close();
      }
    } finally {
      if (releaseLock) await releaseLock();
    }
  });
}
