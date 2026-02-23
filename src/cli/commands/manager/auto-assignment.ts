// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { queryAll } from '../../../db/client.js';
import type { ManagerCheckContext } from './types.js';

function verboseLog(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

async function getPlannedUnassignedStoryCount(ctx: ManagerCheckContext): Promise<number> {
  return ctx.withDb(async db => {
    const rows = queryAll<{ count: number }>(
      db.db,
      "SELECT COUNT(*) as count FROM stories WHERE status = 'planned' AND assigned_agent_id IS NULL"
    );
    return rows[0]?.count || 0;
  });
}

export async function autoAssignPlannedStories(ctx: ManagerCheckContext): Promise<void> {
  const plannedUnassigned = await getPlannedUnassignedStoryCount(ctx);
  verboseLog(ctx, `autoAssignPlannedStories: plannedUnassigned=${plannedUnassigned}`);

  if (plannedUnassigned === 0) {
    return;
  }

  const assignmentResult = await ctx.withDb(async (db, scheduler) => {
    await scheduler.checkScaling();
    await scheduler.checkMergeQueue();
    const result = await scheduler.assignStories();
    db.save();
    return result;
  });

  verboseLog(
    ctx,
    `autoAssignPlannedStories: assigned=${assignmentResult.assigned}, errors=${assignmentResult.errors.length}`
  );
  ctx.counters.plannedAutoAssigned += assignmentResult.assigned;

  if (assignmentResult.assigned > 0) {
    console.log(chalk.green(`  Auto-assigned ${assignmentResult.assigned} planned story(ies)`));
  }

  if (assignmentResult.errors.length > 0) {
    console.log(
      chalk.yellow(`  Auto-assignment encountered ${assignmentResult.errors.length} error(s)`)
    );
    for (const err of assignmentResult.errors) {
      verboseLog(ctx, `autoAssignPlannedStories.error: ${err}`);
    }
  }
}
