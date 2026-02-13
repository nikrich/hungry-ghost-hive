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
  const techLead = getTechLead(ctx.db.db);
  const sessionName = techLead?.tmux_session || 'hive-tech-lead';

  if (!(await isTmuxSessionRunning(sessionName))) {
    return false;
  }

  const requirementLabel = formatRequirementLabel(requirementId);
  const nudgeMessage = `# Manager intervention: planning handoff appears stalled for ${requirementLabel} (${estimatedCount} estimated story/ies).
# Please move stories from estimated -> planned and run:
# hive assign`;
  const cliTool = (techLead?.cli_tool || 'claude') as CLITool;

  await nudgeAgent(ctx.root, sessionName, nudgeMessage, undefined, undefined, cliTool);
  ctx.counters.nudged++;

  createLog(ctx.db.db, {
    agentId: 'manager',
    eventType: 'STORY_PROGRESS_UPDATE',
    message: `Nudged Tech Lead to unblock stalled planning handoff for ${requirementLabel}`,
    metadata: { requirement_id: requirementId, estimated_count: estimatedCount },
  });
  ctx.db.save();
  return true;
}

async function promoteEstimatedStoriesToPlanned(
  ctx: ManagerCheckContext,
  requirementId: string | null,
  stories: StoryRow[],
  reason: string
): Promise<number> {
  let promoted = 0;

  await withTransaction(ctx.db.db, () => {
    for (const story of stories) {
      updateStory(ctx.db.db, story.id, { status: 'planned' });
      promoted++;
    }

    if (requirementId) {
      updateRequirement(ctx.db.db, requirementId, { status: 'planned' });
    }

    createLog(ctx.db.db, {
      agentId: 'manager',
      eventType: 'PLANNING_COMPLETED',
      message: `Auto-promoted ${promoted} estimated story/ies to planned (${reason})`,
      metadata: { requirement_id: requirementId, promoted, reason },
    });
  });

  ctx.db.save();

  // Sync status changes to Jira
  for (const story of stories) {
    await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'planned');
  }

  return promoted;
}

async function runAutoAssignmentAfterHandoff(ctx: ManagerCheckContext): Promise<void> {
  await ctx.scheduler.checkScaling();
  await ctx.scheduler.checkMergeQueue();
  const result = await ctx.scheduler.assignStories();
  ctx.db.save();

  ctx.counters.handoffAutoAssigned += result.assigned;

  if (result.assigned > 0) {
    console.log(
      chalk.green(`  Auto-assigned ${result.assigned} story(ies) after handoff recovery`)
    );
  }

  if (result.errors.length > 0) {
    const reason = `Manager auto-handoff recovered planning but assignment still has errors: ${result.errors.join('; ')}`;
    createEscalation(ctx.db.db, { reason });
    createLog(ctx.db.db, {
      agentId: 'manager',
      eventType: 'ESCALATION_CREATED',
      status: 'error',
      message: reason,
    });
    ctx.db.save();
    console.log(
      chalk.red(`  Auto-assignment errors after handoff recovery (${result.errors.length})`)
    );
  }
}

export async function handleStalledPlanningHandoff(ctx: ManagerCheckContext): Promise<void> {
  const estimatedStories = getStoriesByStatus(ctx.db.db, 'estimated');
  if (estimatedStories.length === 0) {
    planningHandoffState.clear();
    return;
  }

  const groupedStories = new Map<string, { requirementId: string | null; stories: StoryRow[] }>();
  for (const story of estimatedStories) {
    const key = getRequirementKey(story.requirement_id);
    const existing = groupedStories.get(key);
    if (existing) {
      existing.stories.push(story);
    } else {
      groupedStories.set(key, { requirementId: story.requirement_id, stories: [story] });
    }
  }

  const activeKeys = new Set<string>();
  let promotedTotal = 0;
  let shouldRunAutoAssignment = false;
  const nowMs = Date.now();
  const stallThresholdMs = Math.max(1, ctx.config.manager.stuck_threshold_ms);

  for (const [key, group] of groupedStories) {
    activeKeys.add(key);

    const latestUpdateMs = getLatestStoryUpdateMs(group.stories);
    if (latestUpdateMs === 0 || nowMs - latestUpdateMs < stallThresholdMs) {
      planningHandoffState.delete(key);
      continue;
    }

    const activePipelineCount = getActivePipelineCountForRequirement(
      ctx.db.db,
      group.requirementId
    );
    if (activePipelineCount > 0) {
      planningHandoffState.delete(key);
      continue;
    }

    const signature = `${group.stories.length}:${latestUpdateMs}`;
    const previous = planningHandoffState.get(key);

    // First intervention: nudge Tech Lead.
    if (!previous || previous.signature !== signature) {
      const nudged = await nudgeTechLeadForStalledHandoff(
        ctx,
        group.requirementId,
        group.stories.length
      );
      if (nudged) {
        planningHandoffState.set(key, { signature, lastNudgeAt: nowMs });
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
    }
    planningHandoffState.delete(key);
  }

  for (const key of Array.from(planningHandoffState.keys())) {
    if (!activeKeys.has(key)) {
      planningHandoffState.delete(key);
    }
  }

  if (shouldRunAutoAssignment && promotedTotal > 0) {
    await runAutoAssignmentAfterHandoff(ctx);
  }
}
