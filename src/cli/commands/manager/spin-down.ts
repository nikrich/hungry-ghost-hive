// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { StoryRow } from '../../../db/client.js';
import { queryAll, withTransaction } from '../../../db/client.js';
import { getAgentById, updateAgent } from '../../../db/queries/agents.js';
import { createLog } from '../../../db/queries/logs.js';
import { updateStoryAssignment } from '../../../db/queries/stories.js';
import { killTmuxSession, sendToTmuxSession } from '../../../tmux/manager.js';
import type { ManagerCheckContext } from './types.js';
import { AGENT_SPINDOWN_DELAY_MS, IDLE_SPINDOWN_DELAY_MS } from './types.js';

function verboseLog(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  if (!ctx.verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

export async function spinDownMergedAgents(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read merged stories and determine actions (brief lock)
  const actions = await ctx.withDb(async db => {
    const mergedStoriesWithAgents = queryAll<StoryRow>(
      db.db,
      `SELECT * FROM stories WHERE status = 'merged' AND assigned_agent_id IS NOT NULL`
    );
    verboseLog(ctx, `spinDownMergedAgents: mergedStories=${mergedStoriesWithAgents.length}`);

    const result: Array<
      | {
          type: 'clear_assignment';
          storyId: string;
          agentId: string;
          reason: string;
        }
      | {
          type: 'spindown';
          storyId: string;
          agentId: string;
          sessionName: string | null;
        }
    > = [];

    for (const story of mergedStoriesWithAgents) {
      if (!story.assigned_agent_id) continue;

      const agent = getAgentById(db.db, story.assigned_agent_id);
      if (!agent || agent.status === 'terminated') {
        verboseLog(
          ctx,
          `spinDownMergedAgents: story=${story.id} skip=agent_missing_or_terminated status=${agent?.status || 'missing'}`
        );
        continue;
      }

      // Safety: Don't kill agents that are working on other stories
      if (agent.current_story_id && agent.current_story_id !== story.id) {
        await withTransaction(db.db, () => {
          updateStoryAssignment(db.db, story.id, null);
        });
        verboseLog(
          ctx,
          `spinDownMergedAgents: story=${story.id} cleared assignment; agent=${agent.id} moved_to=${agent.current_story_id}`
        );
        continue;
      }

      // Check if agent has other non-merged stories assigned
      const otherActiveStories = queryAll<StoryRow>(
        db.db,
        `SELECT * FROM stories WHERE assigned_agent_id = ? AND id != ? AND status NOT IN ('merged', 'draft')`,
        [agent.id, story.id]
      );
      if (otherActiveStories.length > 0) {
        await withTransaction(db.db, () => {
          updateStoryAssignment(db.db, story.id, null);
        });
        verboseLog(
          ctx,
          `spinDownMergedAgents: story=${story.id} cleared assignment; agent=${agent.id} has_other_active=${otherActiveStories.length}`
        );
        continue;
      }

      const agentSession = ctx.hiveSessions.find(
        s => s.name === agent.tmux_session || s.name.includes(agent.id)
      );

      result.push({
        type: 'spindown',
        storyId: story.id,
        agentId: agent.id,
        sessionName: agentSession?.name || null,
      });
    }

    // Also find working agents with no current story that have no active stories assigned
    const orphanedWorkingAgents = queryAll<{
      id: string;
      tmux_session: string | null;
      type: string;
    }>(
      db.db,
      `SELECT id, tmux_session, type FROM agents
       WHERE status = 'working' AND current_story_id IS NULL AND type != 'tech_lead'`
    );

    for (const agent of orphanedWorkingAgents) {
      const activeStories = queryAll<StoryRow>(
        db.db,
        `SELECT * FROM stories WHERE assigned_agent_id = ? AND status NOT IN ('merged', 'draft')`,
        [agent.id]
      );
      if (activeStories.length > 0) {
        verboseLog(
          ctx,
          `spinDownMergedAgents: orphaned-check skip agent=${agent.id} activeStories=${activeStories.length}`
        );
        continue;
      }

      const agentSession = ctx.hiveSessions.find(
        s => s.name === agent.tmux_session || s.name.includes(agent.id)
      );

      result.push({
        type: 'spindown',
        storyId: '',
        agentId: agent.id,
        sessionName: agentSession?.name || null,
      });
    }

    db.save();
    return result;
  });

  // Phase 2: Tmux operations (no lock)
  const spindownActions = actions.filter(a => a.type === 'spindown');
  for (const action of spindownActions) {
    if (action.sessionName) {
      const msg = action.storyId
        ? `# Congratulations! Your story ${action.storyId} has been merged.\n# Your work is complete. Spinning down...`
        : `# No active stories assigned. Spinning down...`;
      await sendToTmuxSession(action.sessionName, msg);
      await new Promise(resolve => setTimeout(resolve, AGENT_SPINDOWN_DELAY_MS));
      await killTmuxSession(action.sessionName);
    }
  }

  // Phase 3: DB writes (brief lock)
  if (spindownActions.length > 0) {
    await ctx.withDb(async db => {
      for (const action of spindownActions) {
        await withTransaction(db.db, () => {
          updateAgent(db.db, action.agentId, { status: 'terminated', currentStoryId: null });
          createLog(db.db, {
            agentId: action.agentId,
            storyId: action.storyId || undefined,
            eventType: 'AGENT_TERMINATED',
            message: action.storyId
              ? `Agent spun down after story ${action.storyId} was merged`
              : `Agent spun down: status was working with no current story and no active stories`,
          });
          if (action.storyId) {
            updateStoryAssignment(db.db, action.storyId, null);
          }
        });
        verboseLog(
          ctx,
          `spinDownMergedAgents: spun_down agent=${action.agentId} story=${action.storyId || '-'}`
        );
      }
      db.save();
    });

    console.log(
      chalk.green(`  Spun down ${spindownActions.length} agent(s) after successful merge`)
    );
  }
}

export async function spinDownIdleAgents(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read agent state (brief lock)
  const workingAgents = await ctx.withDb(async db => {
    const activeStories = queryAll<StoryRow>(
      db.db,
      `SELECT * FROM stories WHERE status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')`
    );
    verboseLog(ctx, `spinDownIdleAgents: activeStories=${activeStories.length}`);

    if (activeStories.length > 0) {
      verboseLog(ctx, 'spinDownIdleAgents: skip pipeline_not_empty');
      return [];
    }

    const agents = queryAll<{ id: string; tmux_session: string | null; type: string }>(
      db.db,
      `SELECT id, tmux_session, type FROM agents WHERE status = 'working' AND type != 'tech_lead'`
    );
    verboseLog(ctx, `spinDownIdleAgents: workingAgents=${agents.length}`);
    return agents;
  });

  if (workingAgents.length === 0) return;

  // Phase 2: Tmux operations (no lock)
  for (const agent of workingAgents) {
    const agentSession = ctx.hiveSessions.find(s => s.name === agent.tmux_session);
    if (agentSession) {
      await sendToTmuxSession(
        agentSession.name,
        `# All work complete. No stories in pipeline. Spinning down...`
      );
      await new Promise(resolve => setTimeout(resolve, IDLE_SPINDOWN_DELAY_MS));
      await killTmuxSession(agentSession.name);
    }
  }

  // Phase 3: DB writes (brief lock)
  await ctx.withDb(async db => {
    for (const agent of workingAgents) {
      await withTransaction(db.db, () => {
        updateAgent(db.db, agent.id, { status: 'terminated', currentStoryId: null });
        createLog(db.db, {
          agentId: agent.id,
          eventType: 'AGENT_TERMINATED',
          message: 'Agent spun down - no work remaining in pipeline',
        });
      });
      verboseLog(ctx, `spinDownIdleAgents: spun_down agent=${agent.id}`);
    }
    db.save();
  });

  console.log(chalk.green(`  Spun down ${workingAgents.length} idle agent(s) - pipeline empty`));
}
