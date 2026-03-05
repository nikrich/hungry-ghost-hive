// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { getAgentsByType } from '../../../db/queries/agents.js';
import { createLog } from '../../../db/queries/logs.js';
import { getAllTeams } from '../../../db/queries/teams.js';
import type { ManagerCheckContext } from './types.js';

function verboseLogCtx(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

// Module-level state tracking for auditor lifecycle
let lastAuditorSpawnTime = 0;

/** Reset auditor lifecycle state (for testing). */
export function resetAuditorLifecycleState(): void {
  lastAuditorSpawnTime = 0;
}

/** Get the last auditor spawn timestamp (for testing). */
export function getLastAuditorSpawnTime(): number {
  return lastAuditorSpawnTime;
}

/**
 * Spawn an auditor agent if conditions are met:
 * 1. auditor_enabled is true in config
 * 2. Enough time has passed since last spawn (auditor_interval_ms)
 * 3. No previous auditor is still running (active in agents table)
 *
 * Returns true if an auditor was spawned or skipped (auditor path handled),
 * false if auditor is disabled (caller should fall back to nudge).
 */
export async function spawnAuditorIfNeeded(ctx: ManagerCheckContext): Promise<boolean> {
  const { config } = ctx;

  if (!config.manager.auditor_enabled) {
    verboseLogCtx(ctx, 'spawnAuditorIfNeeded: skip=auditor_disabled');
    return false;
  }

  const now = Date.now();
  const intervalMs = config.manager.auditor_interval_ms;
  const elapsed = now - lastAuditorSpawnTime;

  if (elapsed < intervalMs) {
    verboseLogCtx(
      ctx,
      `spawnAuditorIfNeeded: skip=interval_not_reached elapsedMs=${elapsed} intervalMs=${intervalMs}`
    );
    return true;
  }

  // Check if a previous auditor is still running
  const hasActiveAuditor = await ctx.withDb(async db => {
    const auditors = getAgentsByType(db.db, 'auditor');
    return auditors.some(a => a.status === 'idle' || a.status === 'working');
  });

  if (hasActiveAuditor) {
    verboseLogCtx(ctx, 'spawnAuditorIfNeeded: skip=active_auditor_running');
    return true;
  }

  // Spawn a new auditor agent
  try {
    const agent = await ctx.withDb(async (db, scheduler) => {
      const teams = getAllTeams(db.db);
      if (teams.length === 0) {
        verboseLogCtx(ctx, 'spawnAuditorIfNeeded: skip=no_teams');
        return null;
      }

      const team = teams[0];
      const spawned = await scheduler.spawnAuditor(team.id, team.name, team.repo_path);

      createLog(db.db, {
        agentId: spawned.id,
        eventType: 'AGENT_SPAWNED',
        message: `Spawned auditor agent ${spawned.id} for team ${team.name}`,
        metadata: {
          agent_type: 'auditor',
          team_id: team.id,
          team_name: team.name,
        },
      });

      db.save();
      return spawned;
    });

    if (agent) {
      lastAuditorSpawnTime = now;
      ctx.counters.auditorsSpawned++;
      console.log(chalk.green(`  Auditor spawned: ${agent.id}`));
      verboseLogCtx(ctx, `spawnAuditorIfNeeded: spawned agent=${agent.id}`);
    }
  } catch (err) {
    console.error(chalk.red('  Auditor spawn failed:'), err instanceof Error ? err.message : err);
    verboseLogCtx(
      ctx,
      `spawnAuditorIfNeeded: error=${err instanceof Error ? err.message : String(err)}`
    );
  }

  return true;
}
