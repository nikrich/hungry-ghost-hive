// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { syncStatusForStory } from '../../../connectors/project-management/operations.js';
import type { DatabaseClient, StoryRow } from '../../../db/client.js';
import { queryAll, withTransaction } from '../../../db/client.js';
import { getTechLead } from '../../../db/queries/agents.js';
import { createEscalation } from '../../../db/queries/escalations.js';
import { createLog } from '../../../db/queries/logs.js';
import { updateRequirement } from '../../../db/queries/requirements.js';
import { getStoriesByStatus, updateStory } from '../../../db/queries/stories.js';
import { isTmuxSessionRunning } from '../../../tmux/manager.js';
import { nudgeAgent, type CLITool } from './agent-monitoring.js';
import type { ManagerCheckContext, PlanningHandoffTracking } from './types.js';
import { PROACTIVE_HANDOFF_RETRY_DELAY_MS } from './types.js';

// In-memory state tracking for planning handoff dedup
export const planningHandoffState = new Map<string, PlanningHandoffTracking>();

function verboseLog(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

function getRequirementKey(requirementId: string | null): string {
  return requirementId || '__unscoped__';
}

function formatRequirementLabel(requirementId: string | null): string {
  return requirementId || 'unscoped stories';
}

function getLatestStoryUpdateMs(stories: StoryRow[]): number {
  let latestMs = 0;

  for (const story of stories) {
    const updatedAtMs = Date.parse(story.updated_at);
    if (!Number.isNaN(updatedAtMs) && updatedAtMs > latestMs) {
      latestMs = updatedAtMs;
    }
  }

  return latestMs;
}

function getActivePipelineCountForRequirement(
  db: DatabaseClient['db'],
  requirementId: string | null
): number {
  const statuses = `'planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted'`;

  if (requirementId) {
    const result = queryAll<{ count: number }>(
      db,
      `
      SELECT COUNT(*) as count
      FROM stories
      WHERE requirement_id = ?
      AND status IN (${statuses})
    `,
      [requirementId]
    );
    return result[0]?.count || 0;
  }

  const result = queryAll<{ count: number }>(
    db,
    `
    SELECT COUNT(*) as count
    FROM stories
    WHERE requirement_id IS NULL
    AND status IN (${statuses})
  `
  );
  return result[0]?.count || 0;
}

async function nudgeTechLeadForStalledHandoff(
  ctx: ManagerCheckContext,
  requirementId: string | null,
  estimatedCount: number
): Promise<boolean> {
  // Brief lock for DB read
  const techLeadInfo = await ctx.withDb(async db => {
    const techLead = getTechLead(db.db);
    return techLead
      ? { sessionName: techLead.tmux_session || 'hive-tech-lead', cliTool: (techLead.cli_tool || 'claude') as CLITool }
      : { sessionName: 'hive-tech-lead', cliTool: 'claude' as CLITool };
  });

  if (!(await isTmuxSessionRunning(techLeadInfo.sessionName))) {
    verboseLog(ctx, `handoff: tech-lead session not running (${techLeadInfo.sessionName})`);
    return false;
  }

  const requirementLabel = formatRequirementLabel(requirementId);
  const nudgeMessage = `# Manager intervention: planning handoff appears stalled for ${requirementLabel} (${estimatedCount} estimated story/ies).
# Please move stories from estimated -> planned and run:
# hive assign`;

  await nudgeAgent(ctx.root, techLeadInfo.sessionName, nudgeMessage, undefined, undefined, techLeadInfo.cliTool);
  verboseLog(
    ctx,
    `handoff: nudged tech-lead session=${techLeadInfo.sessionName} requirement=${requirementLabel} estimated=${estimatedCount}`
  );
  ctx.counters.nudged++;

  // Brief lock for log write
  await ctx.withDb(async db => {
    createLog(db.db, {
      agentId: 'manager',
      eventType: 'STORY_PROGRESS_UPDATE',
      message: `Nudged Tech Lead to unblock stalled planning handoff for ${requirementLabel}`,
      metadata: { requirement_id: requirementId, estimated_count: estimatedCount },
    });
    db.save();
  });
  return true;
}

async function promoteEstimatedStoriesToPlanned(
  ctx: ManagerCheckContext,
  requirementId: string | null,
  stories: StoryRow[],
  reason: string
): Promise<number> {
  const promoted = await ctx.withDb(async db => {
    let count = 0;

    await withTransaction(db.db, () => {
      for (const story of stories) {
        updateStory(db.db, story.id, { status: 'planned' });
        count++;
      }

      if (requirementId) {
        updateRequirement(db.db, requirementId, { status: 'planned' });
      }

      createLog(db.db, {
        agentId: 'manager',
        eventType: 'PLANNING_COMPLETED',
        message: `Auto-promoted ${count} estimated story/ies to planned (${reason})`,
        metadata: { requirement_id: requirementId, promoted: count, reason },
      });
    });

    db.save();

    // Sync status changes to Jira
    for (const story of stories) {
      await syncStatusForStory(ctx.root, db.db, story.id, 'planned');
    }

    return count;
  });

  return promoted;
}

async function runAutoAssignmentAfterHandoff(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async (db, scheduler) => {
    await scheduler.checkScaling();
    await scheduler.checkMergeQueue();
    const result = await scheduler.assignStories();
    verboseLog(
      ctx,
      `handoff: auto-assignment result assigned=${result.assigned} errors=${result.errors.length}`
    );
    db.save();

    ctx.counters.handoffAutoAssigned += result.assigned;

    if (result.assigned > 0) {
      console.log(
        chalk.green(`  Auto-assigned ${result.assigned} story(ies) after handoff recovery`)
      );
    }

    if (result.errors.length > 0) {
      const reason = `Manager auto-handoff recovered planning but assignment still has errors: ${result.errors.join('; ')}`;
      createEscalation(db.db, { reason });
      createLog(db.db, {
        agentId: 'manager',
        eventType: 'ESCALATION_CREATED',
        status: 'error',
        message: reason,
      });
      db.save();
      console.log(
        chalk.red(`  Auto-assignment errors after handoff recovery (${result.errors.length})`)
      );
    }
  });
}

export async function handleStalledPlanningHandoff(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read estimated stories and evaluate handoff state (brief lock)
  const { groupedStories, estimatedCount } = await ctx.withDb(async db => {
    const estimatedStories = getStoriesByStatus(db.db, 'estimated');
    verboseLog(ctx, `handoff: estimatedStories=${estimatedStories.length}`);

    const grouped = new Map<string, { requirementId: string | null; stories: StoryRow[] }>();
    for (const story of estimatedStories) {
      const key = getRequirementKey(story.requirement_id);
      const existing = grouped.get(key);
      if (existing) {
        existing.stories.push(story);
      } else {
        grouped.set(key, { requirementId: story.requirement_id, stories: [story] });
      }
    }

    // Pre-fetch pipeline counts for all groups
    const groupsWithPipeline: Array<{
      key: string;
      requirementId: string | null;
      stories: StoryRow[];
      activePipelineCount: number;
      latestUpdateMs: number;
    }> = [];

    for (const [key, group] of grouped) {
      const activePipelineCount = getActivePipelineCountForRequirement(db.db, group.requirementId);
      const latestUpdateMs = getLatestStoryUpdateMs(group.stories);
      groupsWithPipeline.push({
        key,
        requirementId: group.requirementId,
        stories: group.stories,
        activePipelineCount,
        latestUpdateMs,
      });
    }

    return { groupedStories: groupsWithPipeline, estimatedCount: estimatedStories.length };
  });

  if (estimatedCount === 0) {
    planningHandoffState.clear();
    verboseLog(ctx, 'handoff: no estimated stories, cleared handoff tracker');
    return;
  }

  // Phase 2: Evaluate and take action (tmux nudges outside lock, DB writes in brief locks)
  const activeKeys = new Set<string>();
  let promotedTotal = 0;
  let shouldRunAutoAssignment = false;
  const nowMs = Date.now();
  const stallThresholdMs = Math.max(1, ctx.config.manager.stuck_threshold_ms);

  for (const group of groupedStories) {
    activeKeys.add(group.key);
    verboseLog(
      ctx,
      `handoff: evaluating requirement=${formatRequirementLabel(group.requirementId)} estimated=${group.stories.length}`
    );

    if (group.latestUpdateMs === 0 || nowMs - group.latestUpdateMs < stallThresholdMs) {
      planningHandoffState.delete(group.key);
      verboseLog(
        ctx,
        `handoff: requirement=${formatRequirementLabel(group.requirementId)} skip=not_stale`
      );
      continue;
    }

    if (group.activePipelineCount > 0) {
      planningHandoffState.delete(group.key);
      verboseLog(
        ctx,
        `handoff: requirement=${formatRequirementLabel(group.requirementId)} skip=active_pipeline count=${group.activePipelineCount}`
      );
      continue;
    }

    const signature = `${group.stories.length}:${group.latestUpdateMs}`;
    const previous = planningHandoffState.get(group.key);

    // First intervention: nudge Tech Lead.
    if (!previous || previous.signature !== signature) {
      const nudged = await nudgeTechLeadForStalledHandoff(
        ctx,
        group.requirementId,
        group.stories.length
      );
      if (nudged) {
        planningHandoffState.set(group.key, { signature, lastNudgeAt: nowMs });
        console.log(
          chalk.yellow(
            `  Nudged Tech Lead for stalled planning handoff (${formatRequirementLabel(group.requirementId)})`
          )
        );
        continue;
      }
    } else {
      const retryDelayMs = Math.max(
        PROACTIVE_HANDOFF_RETRY_DELAY_MS,
        ctx.config.manager.fast_poll_interval
      );
      if (nowMs - previous.lastNudgeAt < retryDelayMs) {
        verboseLog(
          ctx,
          `handoff: requirement=${formatRequirementLabel(group.requirementId)} cooldown_active`
        );
        continue;
      }
    }

    // Second intervention: promote and assign automatically.
    const promoted = await promoteEstimatedStoriesToPlanned(
      ctx,
      group.requirementId,
      group.stories,
      'stalled_planning_handoff'
    );
    if (promoted > 0) {
      promotedTotal += promoted;
      shouldRunAutoAssignment = true;
      ctx.counters.handoffPromoted += promoted;
      console.log(
        chalk.yellow(
          `  Auto-promoted ${promoted} stalled estimated story/ies (${formatRequirementLabel(group.requirementId)})`
        )
      );
      verboseLog(
        ctx,
        `handoff: requirement=${formatRequirementLabel(group.requirementId)} action=auto_promote promoted=${promoted}`
      );
    }
    planningHandoffState.delete(group.key);
  }

  for (const key of Array.from(planningHandoffState.keys())) {
    if (!activeKeys.has(key)) {
      planningHandoffState.delete(key);
    }
  }

  if (shouldRunAutoAssignment && promotedTotal > 0) {
    verboseLog(ctx, `handoff: running auto-assignment after promotedTotal=${promotedTotal}`);
    await runAutoAssignmentAfterHandoff(ctx);
  }
}
