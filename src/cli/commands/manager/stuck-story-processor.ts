// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { execa } from 'execa';
import { join } from 'path';
import { syncStatusForStory } from '../../../connectors/project-management/operations.js';
import type { StoryRow } from '../../../db/client.js';
import { queryAll, withTransaction } from '../../../db/client.js';
import { getAgentById, type getAllAgents } from '../../../db/queries/agents.js';
import { createLog } from '../../../db/queries/logs.js';
import {
  createPullRequest,
  getOpenPullRequestsByStory,
} from '../../../db/queries/pull-requests.js';
import { getStoriesByStatus, updateStory } from '../../../db/queries/stories.js';
import { AgentState } from '../../../state-detectors/types.js';
import { captureTmuxPane } from '../../../tmux/manager.js';
import type { CLITool } from '../../../utils/cli-commands.js';
import { agentStates, detectAgentState } from './agent-monitoring.js';
import { assessCompletionFromOutput } from './done-intelligence.js';
import {
  getMaxStuckNudgesPerStory,
  getScreenStaticInactivityThresholdMs,
  sendManagerNudge,
  verboseLogCtx,
} from './manager-utils.js';
import { findSessionForAgent } from './session-resolution.js';
import {
  clearHumanIntervention,
  getSessionStaticUnchangedForMs,
  isClassifierTimeoutReason,
  markClassifierTimeoutForHumanIntervention,
  markDoneFalseForHumanIntervention,
  shouldDeferStuckReminderUntilStaticWindow,
  shouldIncludeProgressUpdates,
  shouldTreatUnknownAsStuckWaiting,
} from './stuck-story-helpers.js';
import type { ManagerCheckContext } from './types.js';
import { TMUX_CAPTURE_LINES_SHORT } from './types.js';

const DONE_INFERENCE_CONFIDENCE_THRESHOLD = 0.82;

export async function nudgeStuckStories(ctx: ManagerCheckContext): Promise<void> {
  const stuckThresholdMs = Math.max(1, ctx.config.manager.stuck_threshold_ms);
  const staticInactivityThresholdMs = getScreenStaticInactivityThresholdMs(ctx.config);
  const maxStuckNudgesPerStory = getMaxStuckNudgesPerStory(ctx.config);
  const waitingNudgeCooldownMs = Math.max(
    ctx.config.manager.nudge_cooldown_ms,
    staticInactivityThresholdMs
  );
  const staleUpdatedAt = new Date(Date.now() - stuckThresholdMs).toISOString();

  // Phase 1: Read stuck stories and agents (brief lock)
  const candidates = await ctx.withDb(async db => {
    const stuckStories = queryAll<StoryRow>(
      db.db,
      `SELECT * FROM stories
       WHERE status = 'in_progress'
       AND updated_at < ?`,
      [staleUpdatedAt]
    ).filter(story => !['merged', 'completed'].includes(story.status));
    verboseLogCtx(
      ctx,
      `nudgeStuckStories: candidates=${stuckStories.length}, staleBefore=${staleUpdatedAt}, thresholdMs=${stuckThresholdMs}`
    );

    const result: Array<{
      story: StoryRow;
      agent: ReturnType<typeof getAllAgents>[number];
      sessionName: string;
      cliTool: CLITool;
    }> = [];

    for (const story of stuckStories) {
      verboseLogCtx(ctx, `nudgeStuckStories: evaluating story=${story.id}`);
      if (!story.assigned_agent_id) {
        verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=no_assigned_agent`);
        continue;
      }
      const agent = getAgentById(db.db, story.assigned_agent_id);
      if (!agent) {
        verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=missing_agent`);
        continue;
      }
      const agentSession = findSessionForAgent(ctx.hiveSessions, agent);
      if (!agentSession) {
        verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=no_agent_session`);
        continue;
      }
      result.push({
        story,
        agent,
        sessionName: agentSession.name,
        cliTool: (agent.cli_tool || 'claude') as CLITool,
      });
    }
    return result;
  });

  // Phase 2: Tmux captures, AI classifier, nudges (no lock held)
  for (const candidate of candidates) {
    const { story, agent, sessionName, cliTool } = candidate;
    const now = Date.now();
    verboseLogCtx(
      ctx,
      `nudgeStuckStories: story=${story.id} session=${sessionName} cli=${cliTool}`
    );

    const trackedState = agentStates.get(sessionName);
    if (
      trackedState &&
      [
        AgentState.ASKING_QUESTION,
        AgentState.AWAITING_SELECTION,
        AgentState.PLAN_APPROVAL,
        AgentState.PERMISSION_REQUIRED,
        AgentState.USER_DECLINED,
      ].includes(trackedState.lastState)
    ) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=waiting_for_human state=${trackedState.lastState}`
      );
      continue;
    }
    if (trackedState && now - trackedState.lastNudgeTime < waitingNudgeCooldownMs) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=nudge_to_ai_window remainingMs=${waitingNudgeCooldownMs - (now - trackedState.lastNudgeTime)}`
      );
      continue;
    }

    const output = await captureTmuxPane(sessionName, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, cliTool);
    verboseLogCtx(
      ctx,
      `nudgeStuckStories: story=${story.id} detected state=${stateResult.state}, waiting=${stateResult.isWaiting}, needsHuman=${stateResult.needsHuman}`
    );
    if (stateResult.needsHuman) {
      verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=needs_human`);
      continue;
    }
    const sessionUnchangedForMs = getSessionStaticUnchangedForMs(sessionName, now);
    const unknownLooksStuck = shouldTreatUnknownAsStuckWaiting({
      state: stateResult.state,
      isWaiting: stateResult.isWaiting,
      sessionUnchangedForMs,
      staticInactivityThresholdMs,
    });
    if (stateResult.state === AgentState.THINKING) {
      if (trackedState && (trackedState.storyStuckNudgeCount || 0) > 0) {
        trackedState.storyStuckNudgeCount = 0;
      }
      clearHumanIntervention(sessionName);
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=thinking state=${stateResult.state}`
      );
      continue;
    }
    if (!stateResult.isWaiting && !unknownLooksStuck) {
      if (trackedState && (trackedState.storyStuckNudgeCount || 0) > 0) {
        trackedState.storyStuckNudgeCount = 0;
      }
      clearHumanIntervention(sessionName);
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=not_waiting state=${stateResult.state}`
      );
      continue;
    }
    if (unknownLooksStuck) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} action=unknown_state_stuck_heuristic unchangedMs=${sessionUnchangedForMs}`
      );
    }

    if (
      shouldDeferStuckReminderUntilStaticWindow({
        state: stateResult.state,
        sessionUnchangedForMs,
        staticInactivityThresholdMs,
      })
    ) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=done_inference_static_window remainingMs=${staticInactivityThresholdMs - sessionUnchangedForMs}`
      );
      continue;
    } else {
      const completionAssessment = await assessCompletionFromOutput(
        ctx.config,
        sessionName,
        story.id,
        output
      );
      const aiSaysDone =
        completionAssessment.done &&
        completionAssessment.confidence >= DONE_INFERENCE_CONFIDENCE_THRESHOLD;
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} doneInference done=${completionAssessment.done}, confidence=${completionAssessment.confidence.toFixed(2)}, aiSaysDone=${aiSaysDone}, reason=${completionAssessment.reason}`
      );
      if (isClassifierTimeoutReason(completionAssessment.reason)) {
        await markClassifierTimeoutForHumanIntervention(
          ctx,
          sessionName,
          story.id,
          completionAssessment.reason,
          agent.id
        );
        verboseLogCtx(
          ctx,
          `nudgeStuckStories: story=${story.id} action=classifier_timeout_escalation session=${sessionName}`
        );
        continue;
      }
      clearHumanIntervention(sessionName);

      if (aiSaysDone) {
        const progressed = await autoProgressDoneStory(
          ctx,
          story,
          agent,
          sessionName,
          completionAssessment.reason,
          completionAssessment.confidence
        );
        if (progressed) {
          ctx.counters.autoProgressed++;
          verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} action=auto_progressed`);
          continue;
        }
        verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} auto_progress_failed`);
      } else {
        const stuckNudgesSent = trackedState?.storyStuckNudgeCount || 0;
        if (stuckNudgesSent >= maxStuckNudgesPerStory) {
          await markDoneFalseForHumanIntervention(
            ctx,
            sessionName,
            story.id,
            completionAssessment.reason,
            agent.id
          );
          verboseLogCtx(
            ctx,
            `nudgeStuckStories: story=${story.id} action=done_false_escalation session=${sessionName}`
          );
          continue;
        }
      }
    }

    const stuckNudgesSent = trackedState?.storyStuckNudgeCount || 0;
    if (stuckNudgesSent >= maxStuckNudgesPerStory) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=stuck_nudge_limit reached=${stuckNudgesSent}/${maxStuckNudgesPerStory}`
      );
      continue;
    }

    if (stateResult.state === AgentState.WORK_COMPLETE) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} action=mandatory_completion_signal session=${sessionName}`
      );
      const completionSignalLines = [
        `# MANDATORY COMPLETION SIGNAL: execute now for ${story.id}`,
        `hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${story.id} --from ${sessionName}`,
        `hive my-stories complete ${story.id}`,
      ];
      if (shouldIncludeProgressUpdates(ctx.config)) {
        completionSignalLines.push(
          `hive progress ${story.id} -m "PR submitted to merge queue" --from ${sessionName} --done`
        );
      } else {
        completionSignalLines.push(
          '# project_management.provider is none; skip hive progress in this workspace.'
        );
      }
      completionSignalLines.push(
        '# Do not stop at a summary. Completion requires the commands above.'
      );

      await sendManagerNudge(ctx, sessionName, completionSignalLines.join('\n'));
      ctx.counters.nudged++;
      if (trackedState) {
        trackedState.lastNudgeTime = now;
        trackedState.storyStuckNudgeCount = (trackedState.storyStuckNudgeCount || 0) + 1;
      } else {
        agentStates.set(sessionName, {
          lastState: stateResult.state,
          lastStateChangeTime: now,
          lastNudgeTime: now,
          storyStuckNudgeCount: 1,
        });
      }
      continue;
    }

    verboseLogCtx(
      ctx,
      `nudgeStuckStories: story=${story.id} action=stuck_reminder session=${sessionName}`
    );
    await sendManagerNudge(
      ctx,
      sessionName,
      `# REMINDER: Story ${story.id} has been in progress for a while.
# If stuck, escalate to your Senior or Tech Lead.
# If done, submit your PR: hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${story.id} --from ${sessionName}
# Then mark complete: hive my-stories complete ${story.id}`
    );
    ctx.counters.nudged++;
    if (trackedState) {
      trackedState.lastNudgeTime = now;
      trackedState.storyStuckNudgeCount = (trackedState.storyStuckNudgeCount || 0) + 1;
    } else {
      agentStates.set(sessionName, {
        lastState: stateResult.state,
        lastStateChangeTime: now,
        lastNudgeTime: now,
        storyStuckNudgeCount: 1,
      });
    }
  }
}

export async function autoProgressDoneStory(
  ctx: ManagerCheckContext,
  story: StoryRow,
  agent: ReturnType<typeof getAllAgents>[number],
  sessionName: string,
  reason: string,
  confidence: number
): Promise<boolean> {
  verboseLogCtx(
    ctx,
    `autoProgressDoneStory: story=${story.id}, session=${sessionName}, confidence=${confidence.toFixed(2)}`
  );

  // Resolve branch name outside lock (involves git operations)
  const branch = await resolveStoryBranchName(ctx.root, story, agent, msg =>
    verboseLogCtx(ctx, `resolveStoryBranchName: story=${story.id} ${msg}`)
  );

  // DB operations under brief lock
  const action = await ctx.withDb(async (db, scheduler) => {
    const openPRs = getOpenPullRequestsByStory(db.db, story.id);
    verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id}, openPRs=${openPRs.length}`);
    if (openPRs.length > 0) {
      if (story.status !== 'pr_submitted') {
        updateStory(db.db, story.id, { status: 'pr_submitted' });
        createLog(db.db, {
          agentId: 'manager',
          storyId: story.id,
          eventType: 'STORY_PROGRESS_UPDATE',
          message: `Auto-progressed ${story.id} to pr_submitted (existing PR detected)`,
          metadata: {
            session_name: sessionName,
            recovery: 'done_inference_existing_pr',
            reason,
            confidence,
            open_pr_count: openPRs.length,
          },
        });
        db.save();
        await syncStatusForStory(ctx.root, db.db, story.id, 'pr_submitted');
        verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id} status moved to pr_submitted`);
      }
      return 'existing_pr' as const;
    }

    if (!branch) {
      verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id} action=failed_no_branch`);
      return 'no_branch' as const;
    }

    await withTransaction(
      db.db,
      () => {
        updateStory(db.db, story.id, { status: 'pr_submitted', branchName: branch });
        createPullRequest(db.db, {
          storyId: story.id,
          teamId: story.team_id || null,
          branchName: branch,
          submittedBy: sessionName,
        });
        createLog(db.db, {
          agentId: 'manager',
          storyId: story.id,
          eventType: 'PR_SUBMITTED',
          message: `Auto-submitted PR for ${story.id} after AI completion inference`,
          metadata: {
            session_name: sessionName,
            recovery: 'done_inference_auto_submit',
            reason,
            confidence,
            branch,
          },
        });
      },
      () => db.save()
    );
    await syncStatusForStory(ctx.root, db.db, story.id, 'pr_submitted');
    await scheduler.checkMergeQueue();
    db.save();
    verboseLogCtx(
      ctx,
      `autoProgressDoneStory: story=${story.id} action=auto_submitted branch=${branch}`
    );
    return 'auto_submitted' as const;
  });

  // Tmux notifications (no lock needed)
  if (action === 'existing_pr') {
    await sendManagerNudge(
      ctx,
      sessionName,
      `# AUTO-PROGRESS: Manager inferred ${story.id} is complete (confidence ${confidence.toFixed(2)}), detected existing PR, and moved story to PR-submitted state.`
    );
    verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id} action=existing_pr_progressed`);
    return true;
  }

  if (action === 'no_branch') {
    return false;
  }

  await sendManagerNudge(
    ctx,
    sessionName,
    `# AUTO-PROGRESS: Manager inferred ${story.id} is complete (confidence ${confidence.toFixed(2)}), auto-submitted branch ${branch} to merge queue.`
  );
  return true;
}

async function resolveStoryBranchName(
  root: string,
  story: StoryRow,
  agent: ReturnType<typeof getAllAgents>[number],
  log?: (message: string) => void
): Promise<string | null> {
  if (story.branch_name && story.branch_name.trim().length > 0) {
    log?.(`source=story.branch_name value=${story.branch_name.trim()}`);
    return story.branch_name.trim();
  }

  if (!agent.worktree_path) {
    log?.('source=worktree skip=no_worktree_path');
    return null;
  }

  const worktreeDir = join(root, agent.worktree_path);
  try {
    const result = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreeDir });
    const branch = result.stdout.trim();
    if (!branch || branch === 'HEAD') {
      log?.(`source=git_rev_parse invalid_branch=${branch || '(empty)'}`);
      return null;
    }
    log?.(`source=git_rev_parse value=${branch}`);
    return branch;
  } catch {
    log?.(`source=git_rev_parse failed cwd=${worktreeDir}`);
    return null;
  }
}

export async function nudgeQAFailedStories(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read QA-failed stories and agents (brief lock)
  const candidates = await ctx.withDb(async db => {
    const qaFailedStories = getStoriesByStatus(db.db, 'qa_failed').filter(
      story => !['merged', 'completed'].includes(story.status)
    );
    verboseLogCtx(ctx, `nudgeQAFailedStories: candidates=${qaFailedStories.length}`);

    const result: Array<{ storyId: string; sessionName: string; cliTool: CLITool }> = [];
    for (const story of qaFailedStories) {
      if (!story.assigned_agent_id) {
        verboseLogCtx(ctx, `nudgeQAFailedStories: story=${story.id} skip=no_assigned_agent`);
        continue;
      }
      const agent = getAgentById(db.db, story.assigned_agent_id);
      if (!agent || agent.status !== 'working') {
        verboseLogCtx(
          ctx,
          `nudgeQAFailedStories: story=${story.id} skip=agent_not_working status=${agent?.status || 'missing'}`
        );
        continue;
      }
      const agentSession = findSessionForAgent(ctx.hiveSessions, agent);
      if (!agentSession) {
        verboseLogCtx(ctx, `nudgeQAFailedStories: story=${story.id} skip=no_session`);
        continue;
      }
      result.push({
        storyId: story.id,
        sessionName: agentSession.name,
        cliTool: (agent.cli_tool || 'claude') as CLITool,
      });
    }
    return result;
  });

  // Phase 2: Tmux captures and nudges (no lock needed)
  for (const candidate of candidates) {
    const output = await captureTmuxPane(candidate.sessionName, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, candidate.cliTool);

    if (
      stateResult.isWaiting &&
      !stateResult.needsHuman &&
      stateResult.state !== AgentState.THINKING
    ) {
      verboseLogCtx(
        ctx,
        `nudgeQAFailedStories: story=${candidate.storyId} nudge session=${candidate.sessionName} state=${stateResult.state}`
      );
      await sendManagerNudge(
        ctx,
        candidate.sessionName,
        `# REMINDER: Story ${candidate.storyId} failed QA review!
# You must fix the issues and resubmit the PR.
# Check the QA feedback and address all concerns.
hive pr queue`
      );
    } else {
      verboseLogCtx(
        ctx,
        `nudgeQAFailedStories: story=${candidate.storyId} skip=not_ready waiting=${stateResult.isWaiting} needsHuman=${stateResult.needsHuman} state=${stateResult.state}`
      );
    }
  }
}

export async function recoverUnassignedQAFailedStories(ctx: ManagerCheckContext): Promise<void> {
  const result = await ctx.withDb(async (db, scheduler) => {
    const recoverableStories = queryAll<StoryRow>(
      db.db,
      `
      SELECT * FROM stories
      WHERE status = 'qa_failed'
        AND assigned_agent_id IS NULL
    `
    );

    if (recoverableStories.length === 0) return null;
    verboseLogCtx(ctx, `recoverUnassignedQAFailedStories: recovered=${recoverableStories.length}`);

    await withTransaction(
      db.db,
      () => {
        for (const story of recoverableStories) {
          updateStory(db.db, story.id, { status: 'planned', assignedAgentId: null });
          createLog(db.db, {
            agentId: 'manager',
            storyId: story.id,
            eventType: 'ORPHANED_STORY_RECOVERED',
            message: `Recovered QA-failed story ${story.id} (unassigned) back to planned`,
            metadata: { from_status: 'qa_failed', to_status: 'planned' },
          });
        }
      },
      () => db.save()
    );

    for (const story of recoverableStories) {
      await syncStatusForStory(ctx.root, db.db, story.id, 'planned');
    }

    // Proactively re-assign recovered work so it does not stall until manual `hive assign`.
    const assignmentResult = await scheduler.assignStories();
    verboseLogCtx(
      ctx,
      `recoverUnassignedQAFailedStories.assignStories: assigned=${assignmentResult.assigned}, errors=${assignmentResult.errors.length}`
    );
    db.save();

    if (assignmentResult.assigned > 0) {
      await scheduler.flushJiraQueue();
      db.save();
    }

    return { recoverableCount: recoverableStories.length, assignmentResult };
  });

  if (result) {
    console.log(
      chalk.yellow(
        `  Recovered ${result.recoverableCount} QA-failed unassigned story(ies), assigned ${result.assignmentResult.assigned}`
      )
    );
    if (result.assignmentResult.errors.length > 0) {
      console.log(
        chalk.yellow(
          `  Assignment errors during QA-failed recovery: ${result.assignmentResult.errors.length}`
        )
      );
    }
  }
}
