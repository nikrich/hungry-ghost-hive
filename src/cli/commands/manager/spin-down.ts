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

export async function spinDownMergedAgents(ctx: ManagerCheckContext): Promise<void> {
  const mergedStoriesWithAgents = queryAll<StoryRow>(
    ctx.db.db,
    `SELECT * FROM stories WHERE status = 'merged' AND assigned_agent_id IS NOT NULL`
  );

  let agentsSpunDown = 0;
  for (const story of mergedStoriesWithAgents) {
    if (!story.assigned_agent_id) continue;

    const agent = getAgentById(ctx.db.db, story.assigned_agent_id);
    if (!agent || agent.status === 'terminated') continue;

    // Safety: Don't kill agents that are working on other stories
    if (agent.current_story_id && agent.current_story_id !== story.id) {
      // Agent moved on to another story - just clear the merged story's assignment
      await withTransaction(ctx.db.db, () => {
        updateStoryAssignment(ctx.db.db, story.id, null);
      });
      continue;
    }

    // Check if agent has other non-merged stories assigned
    const otherActiveStories = queryAll<StoryRow>(
      ctx.db.db,
      `SELECT * FROM stories WHERE assigned_agent_id = ? AND id != ? AND status NOT IN ('merged', 'draft')`,
      [agent.id, story.id]
    );
    if (otherActiveStories.length > 0) {
      // Agent has other work - just clear the merged story's assignment
      await withTransaction(ctx.db.db, () => {
        updateStoryAssignment(ctx.db.db, story.id, null);
      });
      continue;
    }

    const agentSession = ctx.hiveSessions.find(
      s => s.name === agent.tmux_session || s.name.includes(agent.id)
    );

    if (agentSession) {
      await sendToTmuxSession(
        agentSession.name,
        `# Congratulations! Your story ${story.id} has been merged.
# Your work is complete. Spinning down...`
      );
      await new Promise(resolve => setTimeout(resolve, AGENT_SPINDOWN_DELAY_MS));
      await killTmuxSession(agentSession.name);
    }

    await withTransaction(ctx.db.db, () => {
      updateAgent(ctx.db.db, agent.id, { status: 'terminated', currentStoryId: null });

      createLog(ctx.db.db, {
        agentId: agent.id,
        storyId: story.id,
        eventType: 'AGENT_TERMINATED',
        message: `Agent spun down after story ${story.id} was merged`,
      });

      updateStoryAssignment(ctx.db.db, story.id, null);
    });

    agentsSpunDown++;
  }

  // Also find working agents with no current story that have no active stories assigned
  const orphanedWorkingAgents = queryAll<{
    id: string;
    tmux_session: string | null;
    type: string;
  }>(
    ctx.db.db,
    `SELECT id, tmux_session, type FROM agents
     WHERE status = 'working' AND current_story_id IS NULL AND type != 'tech_lead'`
  );

  for (const agent of orphanedWorkingAgents) {
    // Check if this agent has any active (non-merged) stories assigned
    const activeStories = queryAll<StoryRow>(
      ctx.db.db,
      `SELECT * FROM stories WHERE assigned_agent_id = ? AND status NOT IN ('merged', 'draft')`,
      [agent.id]
    );
    if (activeStories.length > 0) continue;

    const agentSession = ctx.hiveSessions.find(
      s => s.name === agent.tmux_session || s.name.includes(agent.id)
    );

    if (agentSession) {
      await sendToTmuxSession(agentSession.name, `# No active stories assigned. Spinning down...`);
      await new Promise(resolve => setTimeout(resolve, AGENT_SPINDOWN_DELAY_MS));
      await killTmuxSession(agentSession.name);
    }

    await withTransaction(ctx.db.db, () => {
      updateAgent(ctx.db.db, agent.id, { status: 'terminated', currentStoryId: null });
      createLog(ctx.db.db, {
        agentId: agent.id,
        eventType: 'AGENT_TERMINATED',
        message: `Agent spun down: status was working with no current story and no active stories`,
      });
    });

    agentsSpunDown++;
  }

  if (agentsSpunDown > 0) {
    ctx.db.save();
    console.log(chalk.green(`  Spun down ${agentsSpunDown} agent(s) after successful merge`));
  }
}

export async function spinDownIdleAgents(ctx: ManagerCheckContext): Promise<void> {
  const activeStories = queryAll<StoryRow>(
    ctx.db.db,
    `SELECT * FROM stories WHERE status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')`
  );

  if (activeStories.length > 0) return;

  const workingAgents = queryAll<{ id: string; tmux_session: string | null; type: string }>(
    ctx.db.db,
    `SELECT id, tmux_session, type FROM agents WHERE status = 'working' AND type != 'tech_lead'`
  );

  let idleSpunDown = 0;
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

    await withTransaction(ctx.db.db, () => {
      updateAgent(ctx.db.db, agent.id, { status: 'terminated', currentStoryId: null });
      createLog(ctx.db.db, {
        agentId: agent.id,
        eventType: 'AGENT_TERMINATED',
        message: 'Agent spun down - no work remaining in pipeline',
      });
    });
    idleSpunDown++;
  }

  if (idleSpunDown > 0) {
    ctx.db.save();
    console.log(chalk.green(`  Spun down ${idleSpunDown} idle agent(s) - pipeline empty`));
  }
}
