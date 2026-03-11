// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import { loadConfig } from '../../config/loader.js';
import { getDatabase, getReadOnlyDatabase } from '../../db/client.js';
import { acquireLock } from '../../db/lock.js';
import { createTeam, getTeamByName } from '../../db/queries/teams.js';
import { isManagerRunning, startManager, stopManager } from '../../tmux/manager.js';
import type { Router } from '../router.js';
import { readJsonBody, sendJson } from '../server.js';

export function registerSystemRoutes(router: Router, hiveDir: string, rootDir: string): void {
  // Manager status
  router.get('/api/v1/manager/status', async (_req, res) => {
    try {
      const running = await isManagerRunning(hiveDir);
      sendJson(res, 200, { running });
    } catch {
      sendJson(res, 200, { running: false, error: 'Could not check manager status' });
    }
  });

  // Start manager
  router.post('/api/v1/manager/start', async (_req, res) => {
    try {
      const running = await isManagerRunning(hiveDir);
      if (running) {
        sendJson(res, 200, { started: false, message: 'Manager is already running' });
        return;
      }
      const started = await startManager(60, hiveDir);
      sendJson(res, 200, { started, message: started ? 'Manager started' : 'Failed to start' });
    } catch (err) {
      sendJson(res, 500, {
        error: `Failed to start manager: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Stop manager
  router.post('/api/v1/manager/stop', async (_req, res) => {
    try {
      const stopped = await stopManager(hiveDir);
      sendJson(res, 200, {
        stopped,
        message: stopped ? 'Manager stopped' : 'Manager was not running',
      });
    } catch (err) {
      sendJson(res, 500, {
        error: `Failed to stop manager: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Add repo / create team
  router.post('/api/v1/teams', async (req, res) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const teamName = typeof body.team === 'string' ? body.team.trim() : '';
    if (!url || !teamName) {
      sendJson(res, 400, { error: 'url and team are required' });
      return;
    }

    // Extract repo name from URL
    const repoName = url.split('/').pop()?.replace('.git', '') || 'repo';
    const relativeRepoPath = `repos/${repoName}`;
    const branch = typeof body.branch === 'string' ? body.branch.trim() : 'main';

    const dbLockPath = join(hiveDir, 'db');
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      // Check for existing team (read-only first)
      const rdb = await getReadOnlyDatabase(hiveDir);
      try {
        const existing = getTeamByName(rdb.db, teamName);
        if (existing) {
          sendJson(res, 409, { error: `Team "${teamName}" already exists` });
          return;
        }
      } finally {
        rdb.close();
      }

      // Add git submodule
      const { execa } = await import('execa');
      try {
        await execa('git', ['submodule', 'add', '-f', '-b', branch, url, relativeRepoPath], {
          cwd: rootDir,
        });
      } catch (gitErr: unknown) {
        const error = gitErr as { stderr?: string };
        if (error.stderr?.includes('already exists')) {
          await execa('git', ['submodule', 'init', relativeRepoPath], { cwd: rootDir });
          await execa('git', ['submodule', 'update', relativeRepoPath], { cwd: rootDir });
        } else {
          throw gitErr;
        }
      }

      // Create team in database
      releaseLock = await acquireLock(dbLockPath, {
        stale: 30000,
        retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
      });
      const db = await getDatabase(hiveDir);
      try {
        const team = createTeam(db.db, {
          repoUrl: url,
          repoPath: relativeRepoPath,
          name: teamName,
        });
        db.save();
        sendJson(res, 201, team);
      } finally {
        db.close();
      }
    } catch (err) {
      sendJson(res, 500, {
        error: `Failed to add repo: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (releaseLock) await releaseLock();
    }
  });

  // Get config summary (non-sensitive)
  router.get('/api/v1/config', async (_req, res) => {
    try {
      const config = loadConfig(hiveDir);
      sendJson(res, 200, {
        version: config.version,
        integrations: {
          source_control: config.integrations.source_control.provider,
          project_management: config.integrations.project_management.provider,
          autonomy: config.integrations.autonomy.level,
        },
        github: { base_branch: config.github.base_branch },
        scaling: config.scaling,
        manager: {
          fast_poll_interval: config.manager.fast_poll_interval,
          slow_poll_interval: config.manager.slow_poll_interval,
          auditor_enabled: config.manager.auditor_enabled,
        },
      });
    } catch {
      sendJson(res, 500, { error: 'Failed to load config' });
    }
  });
}
