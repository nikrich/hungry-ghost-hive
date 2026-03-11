// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import { getDatabase, getReadOnlyDatabase } from '../../db/client.js';
import { acquireLock } from '../../db/lock.js';
import {
  acknowledgeEscalation,
  getAllEscalations,
  getEscalationById,
  getPendingEscalations,
  resolveEscalation,
} from '../../db/queries/escalations.js';
import type { Router } from '../router.js';
import { readJsonBody, sendJson } from '../server.js';

export function registerEscalationRoutes(router: Router, hiveDir: string): void {
  router.get('/api/v1/escalations', async (_req, res, _params, query) => {
    const db = await getReadOnlyDatabase(hiveDir);
    try {
      const escalations =
        query.all === 'true' ? getAllEscalations(db.db) : getPendingEscalations(db.db);
      sendJson(res, 200, escalations);
    } finally {
      db.close();
    }
  });

  router.post('/api/v1/escalations/:id/resolve', async (req, res, params) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const resolution = typeof body.resolution === 'string' ? body.resolution.trim() : '';
    if (!resolution) {
      sendJson(res, 400, { error: 'resolution is required' });
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
        const existing = getEscalationById(db.db, params.id);
        if (!existing) {
          sendJson(res, 404, { error: 'Escalation not found' });
          return;
        }
        const escalation = resolveEscalation(db.db, params.id, resolution);
        db.save();
        sendJson(res, 200, escalation);
      } finally {
        db.close();
      }
    } finally {
      if (releaseLock) await releaseLock();
    }
  });

  router.post('/api/v1/escalations/:id/acknowledge', async (_req, res, params) => {
    const dbLockPath = join(hiveDir, 'db');
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      releaseLock = await acquireLock(dbLockPath, {
        stale: 30000,
        retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
      });
      const db = await getDatabase(hiveDir);
      try {
        const existing = getEscalationById(db.db, params.id);
        if (!existing) {
          sendJson(res, 404, { error: 'Escalation not found' });
          return;
        }
        const escalation = acknowledgeEscalation(db.db, params.id);
        db.save();
        sendJson(res, 200, escalation);
      } finally {
        db.close();
      }
    } finally {
      if (releaseLock) await releaseLock();
    }
  });
}
