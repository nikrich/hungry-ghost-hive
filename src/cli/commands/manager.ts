// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { join } from 'path';
import { ClusterRuntime, fetchLocalClusterStatus } from '../../cluster/runtime.js';
import { loadConfig } from '../../config/loader.js';
import type { HiveConfig } from '../../config/schema.js';
import type { DatabaseClient, StoryRow } from '../../db/client.js';
import { queryAll, withTransaction } from '../../db/client.js';
import { acquireLock } from '../../db/lock.js';
import { getAgentById, getAllAgents, getTechLead, updateAgent } from '../../db/queries/agents.js';
import {
  createEscalation,
  getActiveEscalationsForAgent,
  getPendingEscalations,
  getRecentEscalationsForAgent,
  updateEscalation,
} from '../../db/queries/escalations.js';
import { createLog } from '../../db/queries/logs.js';
import {
  getAllPendingMessages,
  markMessagesRead,
  type MessageRow,
} from '../../db/queries/messages.js';
import {
  backfillGithubPrNumbers,
  getMergeQueue,
  getPullRequestsByStatus,
  updatePullRequest,
} from '../../db/queries/pull-requests.js';
import { updateRequirement } from '../../db/queries/requirements.js';
import {
  getStoriesByStatus,
  updateStory,
  updateStoryAssignment,
} from '../../db/queries/stories.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { getStateDetector, type StateDetectionResult } from '../../state-detectors/index.js';
import { AgentState } from '../../state-detectors/types.js';
import {
  autoApprovePermission,
  captureTmuxPane,
  forceBypassMode,
  getHiveSessions,
  isManagerRunning,
  isTmuxSessionRunning,
  killTmuxSession,
  sendEnterToTmuxSession,
  sendMessageWithConfirmation,
  sendToTmuxSession,
  stopManager as stopManagerSession,
  type TmuxSession,
} from '../../tmux/manager.js';
import { autoMergeApprovedPRs } from '../../utils/auto-merge.js';
import {
  buildAutoRecoveryReminder,
  getAvailableCommands,
  type CLITool,
} from '../../utils/cli-commands.js';
import { getHivePaths } from '../../utils/paths.js';
import {
  closeStaleGitHubPRs,
  syncAllTeamOpenPRs,
  syncMergedPRsFromGitHub,
} from '../../utils/pr-sync.js';
import { withHiveContext, withHiveRoot } from '../../utils/with-hive-context.js';

// --- Named constants (extracted from inline magic numbers) ---

/** Number of tmux pane lines to capture for agent state detection */
const TMUX_CAPTURE_LINES = 50;
/** Number of tmux pane lines to capture for brief status checks */
const TMUX_CAPTURE_LINES_SHORT = 30;
/** Max retries when forcing bypass mode on an agent */
const BYPASS_MODE_MAX_RETRIES = 3;
/** Lookback window in minutes for recent escalations to avoid duplicates */
const RECENT_ESCALATION_LOOKBACK_MINUTES = 30;
/** Delay in ms after sending a message to an agent before killing session */
const AGENT_SPINDOWN_DELAY_MS = 1000;
/** Delay in ms before killing tmux session when pipeline is empty */
const IDLE_SPINDOWN_DELAY_MS = 500;
/** Delay in ms before sending Enter to prompt after nudge */
const POST_NUDGE_DELAY_MS = 100;
/** Delay in ms between forwarding messages to an agent */
const MESSAGE_FORWARD_DELAY_MS = 100;
/** Delay before escalating a stalled planning handoff from nudge to automation */
const PROACTIVE_HANDOFF_RETRY_DELAY_MS = 60000;

// Agent state tracking for nudge logic
interface AgentStateTracking {
  lastState: AgentState;
  lastStateChangeTime: number;
  lastNudgeTime: number;
}

interface PlanningHandoffTracking {
  signature: string;
  lastNudgeAt: number;
}

// In-memory state tracking per agent session
const agentStates = new Map<string, AgentStateTracking>();
const planningHandoffState = new Map<string, PlanningHandoffTracking>();
const stateDetectors: Record<CLITool, ReturnType<typeof getStateDetector>> = {
  claude: getStateDetector('claude'),
  codex: getStateDetector('codex'),
  gemini: getStateDetector('gemini'),
};

export const managerCommand = new Command('manager').description(
  'Micromanager daemon that keeps agents productive'
);

// Start the manager daemon
managerCommand
  .command('start')
  .description('Start the manager daemon (runs every 60s)')
  .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
  .option('--once', 'Run once and exit')
  .action(async (options: { interval: string; once?: boolean }) => {
    const { root, paths } = withHiveRoot(ctx => ctx);

    // Load config first to get all settings
    const config = loadConfig(paths.hiveDir);
    let clusterRuntime: ClusterRuntime | null = null;

    const lockPath = join(paths.hiveDir, 'manager.lock');

    // Acquire manager lock to ensure singleton
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      releaseLock = await acquireLock(lockPath, { stale: config.manager.lock_stale_ms });
      console.log(chalk.gray('Manager lock acquired'));
    } catch (err) {
      console.error(
        chalk.red('Failed to acquire manager lock - another manager instance may be running.'),
        err
      );
      console.error(
        chalk.gray('If you are sure no other manager is running, remove:'),
        lockPath + '.lock'
      );
      process.exit(1);
    }

    // Release lock on exit
    const cleanup = async () => {
      if (releaseLock) {
        await releaseLock();
        console.log(chalk.gray('\nManager lock released'));
      }
      if (clusterRuntime) {
        await clusterRuntime.stop();
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    if (config.cluster.enabled) {
      clusterRuntime = new ClusterRuntime(config.cluster, { hiveDir: paths.hiveDir });
      await clusterRuntime.start();
      console.log(
        chalk.gray(
          `Cluster runtime started for ${config.cluster.node_id} (${config.cluster.public_url})`
        )
      );
    }

    // Support two modes: legacy single-interval and new two-tier polling
    const useTwoTier = options.interval === '60' && config.manager;

    if (useTwoTier) {
      // Two-tier polling - use slow interval (60s) by default to reduce interruptions
      const slowInterval = config.cluster.enabled
        ? Math.min(config.manager.slow_poll_interval, config.cluster.sync_interval_ms)
        : config.manager.slow_poll_interval;
      console.log(chalk.cyan(`Manager started (polling every ${slowInterval / 1000}s)`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      const runCheck = async () => {
        try {
          await managerCheck(root, config, clusterRuntime);
        } catch (err) {
          console.error(chalk.red('Manager error:'), err);
        }
      };

      await runCheck();

      if (!options.once) {
        setInterval(runCheck, slowInterval);
      } else if (releaseLock) {
        await releaseLock();
        if (clusterRuntime) {
          await clusterRuntime.stop();
        }
      }
    } else {
      // Legacy mode: single interval
      const requestedInterval = parseInt(options.interval, 10) * 1000;
      const interval = config.cluster.enabled
        ? Math.min(requestedInterval, config.cluster.sync_interval_ms)
        : requestedInterval;
      console.log(chalk.cyan(`Manager started (checking every ${interval / 1000}s)`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      const runCheck = async () => {
        try {
          await managerCheck(root, config, clusterRuntime);
        } catch (err) {
          console.error(chalk.red('Manager error:'), err);
        }
      };

      await runCheck();

      if (!options.once) {
        setInterval(runCheck, interval);
      } else if (releaseLock) {
        await releaseLock();
        if (clusterRuntime) {
          await clusterRuntime.stop();
        }
      }
    }
  });

// Run a single check
managerCommand
  .command('check')
  .description('Run a single manager check')
  .action(async () => {
    const { root, paths } = withHiveRoot(ctx => ctx);
    const config = loadConfig(paths.hiveDir);

    if (config.cluster.enabled) {
      const clusterStatus = await fetchLocalClusterStatus(config.cluster);
      if (!clusterStatus) {
        console.error(
          chalk.red(
            'Cluster mode is enabled, but local cluster runtime is unavailable. Start manager first.'
          )
        );
        process.exit(1);
      }
      if (!clusterStatus.is_leader) {
        console.log(
          chalk.yellow(
            `Skipping manager check on follower node (leader: ${clusterStatus.leader_id || 'unknown'}).`
          )
        );
        return;
      }
    }

    await managerCheck(root, config);
  });

// Run health check to sync agents with tmux
managerCommand
  .command('health')
  .description('Sync agent status with actual tmux sessions')
  .action(async () => {
    await withHiveContext(async ({ root, paths, db }) => {
      const config = loadConfig(paths.hiveDir);
      if (config.cluster.enabled) {
        const clusterStatus = await fetchLocalClusterStatus(config.cluster);
        if (!clusterStatus) {
          console.error(
            chalk.red(
              'Cluster mode is enabled, but local cluster runtime is unavailable. Start manager first.'
            )
          );
          process.exit(1);
        }
        if (!clusterStatus.is_leader) {
          console.log(
            chalk.yellow(
              `Skipping health orchestration on follower node (leader: ${clusterStatus.leader_id || 'unknown'}).`
            )
          );
          return;
        }
      }
      const scheduler = new Scheduler(db.db, {
        scaling: config.scaling,
        models: config.models,
        qa: config.qa,
        github: config.github,
        rootDir: root,
        saveFn: () => db.save(),
      });

      console.log(chalk.cyan('Running health check...'));
      const result = await scheduler.healthCheck();
      db.save();

      if (result.terminated === 0) {
        console.log(chalk.green('All agents healthy - tmux sessions match database'));
      } else {
        console.log(chalk.yellow(`Cleaned up ${result.terminated} dead agent(s)`));
        if (result.revived.length > 0) {
          console.log(chalk.yellow(`Stories returned to queue: ${result.revived.join(', ')}`));
        }
      }

      // Also check merge queue
      console.log(chalk.cyan('Checking merge queue...'));
      await scheduler.checkMergeQueue();
      db.save();
      console.log(chalk.green('Done'));
    });
  });

// Check manager status
managerCommand
  .command('status')
  .description('Check if the manager daemon is running')
  .action(async () => {
    const running = await isManagerRunning();
    if (running) {
      console.log(chalk.green('Manager daemon is running (hive-manager tmux session)'));
      console.log(chalk.gray('To view: tmux attach -t hive-manager'));
      console.log(chalk.gray('To stop: hive manager stop'));
    } else {
      console.log(chalk.yellow('Manager daemon is not running'));
      console.log(chalk.gray('To start: hive manager start'));
    }
  });

// Stop the manager daemon
managerCommand
  .command('stop')
  .description('Stop the manager daemon')
  .action(async () => {
    const stopped = await stopManagerSession();
    if (stopped) {
      console.log(chalk.green('Manager daemon stopped'));
    } else {
      console.log(chalk.yellow('Manager daemon was not running'));
    }
  });

// Nudge a specific agent
managerCommand
  .command('nudge <session>')
  .description('Nudge an agent to check for work')
  .option('-m, --message <msg>', 'Custom message to send')
  .action(async (session: string, options: { message?: string }) => {
    await withHiveContext(async ({ root, db }) => {
      const agent = getAgentById(db.db, session.replace('hive-', ''));
      const cliTool = (agent?.cli_tool || 'claude') as CLITool;
      await nudgeAgent(root, session, options.message, undefined, undefined, cliTool);
      console.log(chalk.green(`Nudged ${session}`));
    });
  });

// Shared context passed between helper functions during a manager check cycle
interface ManagerCheckContext {
  root: string;
  config: HiveConfig;
  paths: ReturnType<typeof getHivePaths>;
  db: DatabaseClient;
  scheduler: InstanceType<typeof Scheduler>;
  hiveSessions: TmuxSession[];
  // Counters accumulated across helpers
  counters: {
    nudged: number;
    messagesForwarded: number;
    escalationsCreated: number;
    escalationsResolved: number;
    queuedPRCount: number;
    handoffPromoted: number;
    handoffAutoAssigned: number;
  };
  // Shared state for dedup
  escalatedSessions: Set<string | null>;
  agentsBySessionName: Map<string, ReturnType<typeof getAllAgents>[number]>;
  messagesToMarkRead: string[];
}

async function managerCheck(
  root: string,
  config?: HiveConfig,
  clusterRuntime?: ClusterRuntime | null
): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(chalk.gray(`[${timestamp}] Manager checking...`));

  await withHiveContext(async ({ paths, db }) => {
    // Load config if not provided (for backwards compatibility)
    if (!config) {
      config = loadConfig(paths.hiveDir);
    }

    if (clusterRuntime?.isEnabled()) {
      const syncResult = await clusterRuntime.sync(db.db);
      if (!clusterRuntime.isLeader()) {
        const status = clusterRuntime.getStatus();
        if (await isTmuxSessionRunning('hive-tech-lead')) {
          await killTmuxSession('hive-tech-lead');
        }
        const details = [];
        if (syncResult.local_events_emitted > 0) {
          details.push(`${syncResult.local_events_emitted} local events`);
        }
        if (syncResult.imported_events_applied > 0) {
          details.push(`${syncResult.imported_events_applied} imported events`);
        }
        if (syncResult.merged_duplicate_stories > 0) {
          details.push(`${syncResult.merged_duplicate_stories} merged stories`);
        }

        console.log(
          chalk.gray(
            `  Cluster follower mode (leader: ${status.leader_id || 'unknown'})${
              details.length > 0 ? `, ${details.join(', ')}` : ''
            }`
          )
        );
        db.save();
        return;
      }

      const leaderStatus = clusterRuntime.getStatus();
      console.log(
        chalk.gray(`  Cluster leader mode (${leaderStatus.node_id}, term ${leaderStatus.term})`)
      );
    }

    const ctx: ManagerCheckContext = {
      root,
      config,
      paths,
      db,
      scheduler: new Scheduler(db.db, {
        scaling: config.scaling,
        models: config.models,
        qa: config.qa,
        github: config.github,
        rootDir: root,
        saveFn: () => db.save(),
      }),
      hiveSessions: [],
      counters: {
        nudged: 0,
        messagesForwarded: 0,
        escalationsCreated: 0,
        escalationsResolved: 0,
        queuedPRCount: 0,
        handoffPromoted: 0,
        handoffAutoAssigned: 0,
      },
      escalatedSessions: new Set(),
      agentsBySessionName: new Map(),
      messagesToMarkRead: [],
    };

    await backfillPRNumbers(ctx);
    await runHealthCheck(ctx);
    await checkMergeQueue(ctx);
    await runAutoMerge(ctx);
    await syncMergedPRs(ctx);
    await syncOpenPRs(ctx);
    await closeStalePRs(ctx);
    await handleStalledPlanningHandoff(ctx);

    // Discover active tmux sessions
    const sessions = await getHiveSessions();
    ctx.hiveSessions = sessions.filter(s => s.name.startsWith('hive-'));

    if (ctx.hiveSessions.length === 0) {
      console.log(chalk.gray('  No agent sessions found'));
      return;
    }

    prepareSessionData(ctx);
    await scanAgentSessions(ctx);
    batchMarkMessagesRead(ctx);
    await notifyQAOfQueuedPRs(ctx);
    await handleRejectedPRs(ctx);
    await nudgeQAFailedStories(ctx);
    await spinDownMergedAgents(ctx);
    await spinDownIdleAgents(ctx);
    await nudgeStuckStories(ctx);
    await notifyUnassignedStories(ctx);
    printSummary(ctx);
  });
}

async function backfillPRNumbers(ctx: ManagerCheckContext): Promise<void> {
  const backfilled = backfillGithubPrNumbers(ctx.db.db);
  if (backfilled > 0) {
    console.log(chalk.yellow(`  Backfilled ${backfilled} PR(s) with github_pr_number from URL`));
    ctx.db.save();
  }
}

async function runHealthCheck(ctx: ManagerCheckContext): Promise<void> {
  const healthResult = await ctx.scheduler.healthCheck();
  if (healthResult.terminated > 0) {
    console.log(
      chalk.yellow(`  Health check: ${healthResult.terminated} dead agent(s) cleaned up`)
    );
    if (healthResult.revived.length > 0) {
      console.log(chalk.yellow(`  Stories returned to queue: ${healthResult.revived.join(', ')}`));
    }
    ctx.db.save();
  }

  if (healthResult.orphanedRecovered.length > 0) {
    console.log(
      chalk.green(
        `  Recovered ${healthResult.orphanedRecovered.length} orphaned story(ies): ${healthResult.orphanedRecovered.join(', ')}`
      )
    );
    ctx.db.save();
  }
}

async function checkMergeQueue(ctx: ManagerCheckContext): Promise<void> {
  await ctx.scheduler.checkMergeQueue();
  ctx.db.save();
}

async function runAutoMerge(ctx: ManagerCheckContext): Promise<void> {
  const autoMerged = await autoMergeApprovedPRs(ctx.root, ctx.db);
  if (autoMerged > 0) {
    console.log(chalk.green(`  Auto-merged ${autoMerged} approved PR(s)`));
    ctx.db.save();
  }
}

async function syncMergedPRs(ctx: ManagerCheckContext): Promise<void> {
  const mergedSynced = await syncMergedPRsFromGitHub(ctx.root, ctx.db.db, () => ctx.db.save());
  if (mergedSynced > 0) {
    console.log(chalk.green(`  Synced ${mergedSynced} merged story(ies) from GitHub`));
  }
}

async function syncOpenPRs(ctx: ManagerCheckContext): Promise<void> {
  const syncedPRs = await syncAllTeamOpenPRs(ctx.root, ctx.db.db, () => ctx.db.save());
  if (syncedPRs > 0) {
    console.log(chalk.yellow(`  Synced ${syncedPRs} GitHub PR(s) into merge queue`));
    await ctx.scheduler.checkMergeQueue();
    ctx.db.save();
  }
}

async function closeStalePRs(ctx: ManagerCheckContext): Promise<void> {
  const closedPRs = await closeStaleGitHubPRs(ctx.root, ctx.db.db);
  if (closedPRs > 0) {
    console.log(chalk.yellow(`  Closed ${closedPRs} stale GitHub PR(s)`));
    ctx.db.save();
  }
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

async function handleStalledPlanningHandoff(ctx: ManagerCheckContext): Promise<void> {
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

function prepareSessionData(ctx: ManagerCheckContext): void {
  // Pre-populate escalation dedup set
  const existingEscalations = getPendingEscalations(ctx.db.db);
  ctx.escalatedSessions = new Set(
    existingEscalations.filter(e => e.from_agent_id).map(e => e.from_agent_id)
  );

  // Batch fetch all agents and index by session name
  const allAgents = getAllAgents(ctx.db.db);
  ctx.agentsBySessionName = new Map(allAgents.map(a => [`hive-${a.id}`, a]));
}

function detectAgentState(output: string, cliTool: CLITool): StateDetectionResult {
  return stateDetectors[cliTool].detectState(output);
}

function describeAgentState(state: AgentState, cliTool: CLITool): string {
  return stateDetectors[cliTool].getStateDescription(state);
}

function getAgentSafetyMode(
  config: HiveConfig,
  agent: ReturnType<typeof getAllAgents>[number] | undefined
): 'safe' | 'unsafe' {
  if (!agent) return 'unsafe';
  return config.models[agent.type].safety_mode;
}

async function scanAgentSessions(ctx: ManagerCheckContext): Promise<void> {
  // Batch fetch pending messages and group by recipient
  const allPendingMessages = getAllPendingMessages(ctx.db.db);
  const messagesBySessionName = new Map<string, MessageRow[]>();

  for (const msg of allPendingMessages) {
    if (!messagesBySessionName.has(msg.to_session)) {
      messagesBySessionName.set(msg.to_session, []);
    }
    messagesBySessionName.get(msg.to_session)!.push(msg);
  }

  for (const session of ctx.hiveSessions) {
    if (session.name === 'hive-manager') continue;

    const agent = ctx.agentsBySessionName.get(session.name);
    const agentCliTool = (agent?.cli_tool || 'claude') as CLITool;
    const safetyMode = getAgentSafetyMode(ctx.config, agent);

    // Forward unread messages
    const unread = messagesBySessionName.get(session.name) || [];
    if (unread.length > 0) {
      await forwardMessages(session.name, unread, agentCliTool);
      ctx.counters.messagesForwarded += unread.length;
      ctx.messagesToMarkRead.push(...unread.map(msg => msg.id));
    }

    const output = await captureTmuxPane(session.name, TMUX_CAPTURE_LINES);

    await enforceBypassMode(session.name, output, agentCliTool, safetyMode);

    const stateResult = detectAgentState(output, agentCliTool);
    const now = Date.now();

    updateAgentStateTracking(session.name, stateResult, now);

    const handled = await handlePermissionPrompt(ctx, session.name, stateResult, safetyMode);
    if (handled) continue;

    await handlePlanApproval(session.name, stateResult, now, agentCliTool, safetyMode);

    await handleEscalationAndNudge(ctx, session.name, agent, stateResult, agentCliTool, now);
  }
}

async function enforceBypassMode(
  sessionName: string,
  output: string,
  agentCliTool: CLITool,
  safetyMode: 'safe' | 'unsafe'
): Promise<void> {
  if (safetyMode === 'safe') {
    return;
  }

  const needsBypassEnforcement =
    output.toLowerCase().includes('plan mode on') ||
    output.toLowerCase().includes('safe mode on') ||
    output.match(/permission.*required/i) ||
    output.match(/approve.*\[y\/n\]/i);

  if (needsBypassEnforcement) {
    const enforced = await forceBypassMode(sessionName, agentCliTool, BYPASS_MODE_MAX_RETRIES);
    if (enforced) {
      console.log(chalk.yellow(`  Enforced bypass mode on ${sessionName}`));
    } else {
      console.log(chalk.red(`  Failed to enforce bypass mode on ${sessionName}`));
    }
  }
}

function updateAgentStateTracking(
  sessionName: string,
  stateResult: StateDetectionResult,
  now: number
): void {
  const trackedState = agentStates.get(sessionName);

  if (!trackedState) {
    agentStates.set(sessionName, {
      lastState: stateResult.state,
      lastStateChangeTime: now,
      lastNudgeTime: 0,
    });
  } else if (trackedState.lastState !== stateResult.state) {
    trackedState.lastState = stateResult.state;
    trackedState.lastStateChangeTime = now;
  }
}

async function handlePermissionPrompt(
  ctx: ManagerCheckContext,
  sessionName: string,
  stateResult: StateDetectionResult,
  safetyMode: 'safe' | 'unsafe'
): Promise<boolean> {
  if (stateResult.state === AgentState.PERMISSION_REQUIRED && safetyMode === 'unsafe') {
    const approved = await autoApprovePermission(sessionName);
    if (approved) {
      createLog(ctx.db.db, {
        agentId: 'manager',
        eventType: 'STORY_PROGRESS_UPDATE',
        message: `Auto-approved permission prompt for ${sessionName}`,
        metadata: {
          session_name: sessionName,
          detected_state: stateResult.state,
        },
      });
      ctx.db.save();
      console.log(chalk.green(`  AUTO-APPROVED: ${sessionName} permission prompt`));
      return true;
    }
  }
  return false;
}

async function handlePlanApproval(
  sessionName: string,
  stateResult: StateDetectionResult,
  now: number,
  agentCliTool: CLITool,
  safetyMode: 'safe' | 'unsafe'
): Promise<void> {
  if (stateResult.state === AgentState.PLAN_APPROVAL && safetyMode === 'unsafe') {
    const restored = await forceBypassMode(sessionName, agentCliTool);
    if (restored) {
      console.log(chalk.green(`  BYPASS MODE RESTORED: ${sessionName} cycled out of plan mode`));
      const tracked = agentStates.get(sessionName);
      if (tracked) {
        tracked.lastState = AgentState.IDLE_AT_PROMPT;
        tracked.lastStateChangeTime = now;
      }
    }
  }
}

async function handleEscalationAndNudge(
  ctx: ManagerCheckContext,
  sessionName: string,
  agent: ReturnType<typeof getAllAgents>[number] | undefined,
  stateResult: StateDetectionResult,
  agentCliTool: CLITool,
  now: number
): Promise<void> {
  const waitingInfo = {
    isWaiting: stateResult.isWaiting,
    needsHuman: stateResult.needsHuman,
    reason: stateResult.needsHuman
      ? describeAgentState(stateResult.state, agentCliTool)
      : undefined,
  };

  const hasRecentEscalation =
    ctx.escalatedSessions.has(sessionName) ||
    getRecentEscalationsForAgent(ctx.db.db, sessionName, RECENT_ESCALATION_LOOKBACK_MINUTES)
      .length > 0;

  if (waitingInfo.needsHuman && !hasRecentEscalation) {
    // Create escalation for human attention
    const storyId = agent?.current_story_id || null;

    const escalation = createEscalation(ctx.db.db, {
      storyId,
      fromAgentId: sessionName,
      toAgentId: null,
      reason: `Approval required: ${waitingInfo.reason || 'Unknown question'}`,
    });
    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId,
      eventType: 'ESCALATION_CREATED',
      status: 'error',
      message: `${sessionName} requires human approval: ${waitingInfo.reason || 'Unknown question'}`,
      metadata: {
        escalation_id: escalation.id,
        session_name: sessionName,
        detected_state: stateResult.state,
      },
    });
    ctx.db.save();
    ctx.counters.escalationsCreated++;
    ctx.escalatedSessions.add(sessionName);

    const reminder = buildAutoRecoveryReminder(sessionName, agentCliTool);
    await sendToTmuxSession(sessionName, reminder);

    console.log(chalk.red(`  ESCALATION: ${sessionName} needs human input`));
  } else if (!waitingInfo.isWaiting && !waitingInfo.needsHuman) {
    // Agent recovered - auto-resolve active escalations
    const activeEscalations = getActiveEscalationsForAgent(ctx.db.db, sessionName);
    for (const escalation of activeEscalations) {
      updateEscalation(ctx.db.db, escalation.id, {
        status: 'resolved',
        resolution: `Agent recovered: no longer in waiting state`,
      });
      ctx.counters.escalationsResolved++;
    }
    if (activeEscalations.length > 0) {
      createLog(ctx.db.db, {
        agentId: 'manager',
        eventType: 'ESCALATION_RESOLVED',
        message: `${sessionName} recovered and manager auto-resolved ${activeEscalations.length} escalation(s)`,
        metadata: {
          session_name: sessionName,
          resolved_count: activeEscalations.length,
        },
      });
      ctx.db.save();
      console.log(
        chalk.green(
          `  AUTO-RESOLVED: ${sessionName} recovered, resolved ${activeEscalations.length} escalation(s)`
        )
      );
    }
  } else if (waitingInfo.isWaiting && stateResult.state !== AgentState.THINKING) {
    // Agent idle/waiting - check if we should nudge
    const currentTrackedState = agentStates.get(sessionName);
    if (currentTrackedState) {
      const timeSinceStateChange = now - currentTrackedState.lastStateChangeTime;
      const timeSinceLastNudge = now - currentTrackedState.lastNudgeTime;

      if (
        timeSinceStateChange > ctx.config.manager.stuck_threshold_ms &&
        timeSinceLastNudge > ctx.config.manager.nudge_cooldown_ms
      ) {
        const recheckOutput = await captureTmuxPane(sessionName, TMUX_CAPTURE_LINES);
        const recheckState = detectAgentState(recheckOutput, agentCliTool);

        if (
          recheckState.isWaiting &&
          !recheckState.needsHuman &&
          recheckState.state !== AgentState.THINKING
        ) {
          const agentType = getAgentType(sessionName);
          await nudgeAgent(
            ctx.root,
            sessionName,
            undefined,
            agentType,
            waitingInfo.reason,
            agentCliTool
          );
          currentTrackedState.lastNudgeTime = now;
          ctx.counters.nudged++;
        }
      }
    }
  }
}

function batchMarkMessagesRead(ctx: ManagerCheckContext): void {
  if (ctx.messagesToMarkRead.length > 0) {
    markMessagesRead(ctx.db.db, ctx.messagesToMarkRead);
    ctx.db.save();
  }
}

async function notifyQAOfQueuedPRs(ctx: ManagerCheckContext): Promise<void> {
  const queuedPRs = getMergeQueue(ctx.db.db);
  ctx.counters.queuedPRCount = queuedPRs.length;

  if (queuedPRs.length > 0) {
    const qaSessions = ctx.hiveSessions.filter(s => s.name.includes('-qa-'));
    for (const qa of qaSessions) {
      // Only notify idle QA agents to avoid interrupting their work
      const agent = ctx.agentsBySessionName.get(qa.name);
      if (agent && agent.status === 'idle') {
        await sendToTmuxSession(
          qa.name,
          `# ${queuedPRs.length} PR(s) waiting in queue. Run: hive pr queue`
        );
      }
    }
  }
}

async function handleRejectedPRs(ctx: ManagerCheckContext): Promise<void> {
  const rejectedPRs = getPullRequestsByStatus(ctx.db.db, 'rejected');
  let rejectionNotified = 0;

  for (const pr of rejectedPRs) {
    if (pr.story_id) {
      const storyId = pr.story_id;
      await withTransaction(ctx.db.db, () => {
        updateStory(ctx.db.db, storyId, { status: 'qa_failed' });
        createLog(ctx.db.db, {
          agentId: 'manager',
          eventType: 'STORY_QA_FAILED',
          message: `Story ${storyId} QA failed: ${pr.review_notes || 'See review comments'}`,
          storyId: storyId,
        });
      });
    }

    if (pr.submitted_by) {
      const devSession = ctx.hiveSessions.find(s => s.name === pr.submitted_by);
      if (devSession) {
        await sendToTmuxSession(
          devSession.name,
          `# ⚠️ PR REJECTED - ACTION REQUIRED ⚠️
# Story: ${pr.story_id || 'Unknown'}
# Reason: ${pr.review_notes || 'See review comments'}
#
# You MUST fix this issue before doing anything else.
# Fix the issues and resubmit: hive pr submit -b ${pr.branch_name} -s ${pr.story_id || 'STORY-ID'} --from ${devSession.name}`
        );
        await sendEnterToTmuxSession(devSession.name);
        rejectionNotified++;
      }
    }

    // Mark as closed to prevent re-notification spam
    // Developer will create a new PR when they resubmit
    await withTransaction(ctx.db.db, () => {
      updatePullRequest(ctx.db.db, pr.id, { status: 'closed' });
    });
  }

  if (rejectedPRs.length > 0) {
    ctx.db.save();
    console.log(chalk.yellow(`  Notified ${rejectionNotified} developer(s) of PR rejection(s)`));
  }
}

async function nudgeQAFailedStories(ctx: ManagerCheckContext): Promise<void> {
  const qaFailedStories = getStoriesByStatus(ctx.db.db, 'qa_failed').filter(
    story => !['merged', 'completed'].includes(story.status)
  );

  for (const story of qaFailedStories) {
    if (!story.assigned_agent_id) continue;

    const agent = getAgentById(ctx.db.db, story.assigned_agent_id);
    if (!agent || agent.status !== 'working') continue;

    const agentSession = ctx.hiveSessions.find(
      s => s.name === agent.tmux_session || s.name.includes(agent.id)
    );
    if (!agentSession) continue;
    const agentCliTool = (agent.cli_tool || 'claude') as CLITool;

    const output = await captureTmuxPane(agentSession.name, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, agentCliTool);

    if (
      stateResult.isWaiting &&
      !stateResult.needsHuman &&
      stateResult.state !== AgentState.THINKING
    ) {
      await sendToTmuxSession(
        agentSession.name,
        `# REMINDER: Story ${story.id} failed QA review!
# You must fix the issues and resubmit the PR.
# Check the QA feedback and address all concerns.
hive pr queue`
      );
      await sendEnterToTmuxSession(agentSession.name);
    }
  }
}

async function spinDownMergedAgents(ctx: ManagerCheckContext): Promise<void> {
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

  if (agentsSpunDown > 0) {
    ctx.db.save();
    console.log(chalk.green(`  Spun down ${agentsSpunDown} agent(s) after successful merge`));
  }
}

async function spinDownIdleAgents(ctx: ManagerCheckContext): Promise<void> {
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

async function nudgeStuckStories(ctx: ManagerCheckContext): Promise<void> {
  const stuckThresholdMs = Math.max(1, ctx.config.manager.stuck_threshold_ms);
  const staleUpdatedAt = new Date(Date.now() - stuckThresholdMs).toISOString();
  const stuckStories = queryAll<StoryRow>(
    ctx.db.db,
    `SELECT * FROM stories
     WHERE status = 'in_progress'
     AND updated_at < ?`,
    [staleUpdatedAt]
  ).filter(story => !['merged', 'completed'].includes(story.status));

  for (const story of stuckStories) {
    if (!story.assigned_agent_id) continue;

    const agentSession = ctx.hiveSessions.find(s =>
      s.name.includes(story.assigned_agent_id?.replace(/^hive-/, '') || '')
    );
    if (agentSession) {
      await sendToTmuxSession(
        agentSession.name,
        `# REMINDER: Story ${story.id} has been in progress for a while.
# If stuck, escalate to your Senior or Tech Lead.
# If done, submit your PR: hive pr submit -b <branch> -s ${story.id} --from ${agentSession.name}
# Then mark complete: hive my-stories complete ${story.id}`
      );
    }
  }
}

async function notifyUnassignedStories(ctx: ManagerCheckContext): Promise<void> {
  const plannedStories = queryAll<StoryRow>(
    ctx.db.db,
    "SELECT * FROM stories WHERE status = 'planned' AND assigned_agent_id IS NULL"
  );

  if (plannedStories.length === 0) return;

  const seniorSessions = ctx.hiveSessions.filter(s => s.name.includes('-senior-'));
  for (const senior of seniorSessions) {
    const seniorAgent = ctx.agentsBySessionName.get(senior.name);
    const seniorCliTool = (seniorAgent?.cli_tool || 'claude') as CLITool;
    const output = await captureTmuxPane(senior.name, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, seniorCliTool);

    if (
      stateResult.isWaiting &&
      !stateResult.needsHuman &&
      stateResult.state !== AgentState.THINKING
    ) {
      await sendToTmuxSession(
        senior.name,
        `# ${plannedStories.length} unassigned story(ies). Run: hive my-stories ${senior.name} --all`
      );
    }
  }
}

function printSummary(ctx: ManagerCheckContext): void {
  const {
    escalationsCreated,
    escalationsResolved,
    nudged,
    messagesForwarded,
    queuedPRCount,
    handoffPromoted,
    handoffAutoAssigned,
  } = ctx.counters;
  const summary = [];

  if (escalationsCreated > 0) summary.push(`${escalationsCreated} escalations created`);
  if (escalationsResolved > 0) summary.push(`${escalationsResolved} escalations auto-resolved`);
  if (nudged > 0) summary.push(`${nudged} nudged`);
  if (messagesForwarded > 0) summary.push(`${messagesForwarded} messages forwarded`);
  if (queuedPRCount > 0) summary.push(`${queuedPRCount} PRs queued`);
  if (handoffPromoted > 0) summary.push(`${handoffPromoted} auto-promoted from estimated`);
  if (handoffAutoAssigned > 0) summary.push(`${handoffAutoAssigned} auto-assigned after recovery`);

  if (summary.length > 0) {
    console.log(chalk.yellow(`  ${summary.join(', ')}`));
  } else {
    console.log(chalk.green('  All agents productive'));
  }
}

function getAgentType(
  sessionName: string
): 'senior' | 'intermediate' | 'junior' | 'qa' | 'unknown' {
  if (sessionName.includes('-senior-')) return 'senior';
  if (sessionName.includes('-intermediate-')) return 'intermediate';
  if (sessionName.includes('-junior-')) return 'junior';
  if (sessionName.includes('-qa-')) return 'qa';
  return 'unknown';
}

async function nudgeAgent(
  _root: string,
  sessionName: string,
  customMessage?: string,
  agentType?: string,
  reason?: string,
  agentCliTool?: CLITool
): Promise<void> {
  if (customMessage) {
    await sendToTmuxSession(sessionName, customMessage);
    return;
  }

  const type = agentType || getAgentType(sessionName);
  const cliTool = agentCliTool || ('claude' as CLITool);
  const commands = getAvailableCommands(cliTool);

  // Build contextual nudge message based on agent type and reason
  let nudge: string;
  switch (type) {
    case 'qa':
      nudge = `# You are a QA agent. Check for PRs to review:
# ${commands.queueCheck()}
# If there are PRs, review them with: hive pr review <pr-id>`;
      break;
    case 'senior':
      nudge = `# You are a Senior developer. Continue with your assigned stories.
# Check your work: # ${commands.getMyStories(sessionName)}
# If no active stories, check for available work: hive stories list --status planned`;
      break;
    case 'intermediate':
    case 'junior':
      nudge = `# Continue with your assigned story. Check status:
# ${commands.getMyStories(sessionName)}
# If stuck, ask your Senior for help via: hive msg send hive-senior-<team> "your question"
# If done, submit PR: hive pr submit -b <branch> -s <story-id> --from ${sessionName}`;
      break;
    default:
      nudge = `# Check current status and continue working:
hive status`;
  }

  // Add reason context if provided
  if (reason) {
    nudge = `# Manager detected: ${reason}\n${nudge}`;
  }

  await sendToTmuxSession(sessionName, nudge);

  // Also send Enter to ensure prompt is activated
  await new Promise(resolve => setTimeout(resolve, POST_NUDGE_DELAY_MS));
  await sendEnterToTmuxSession(sessionName);
}

async function forwardMessages(
  sessionName: string,
  messages: MessageRow[],
  cliTool: CLITool = 'claude'
): Promise<void> {
  const commands = getAvailableCommands(cliTool);
  for (const msg of messages) {
    const notification = `# New message from ${msg.from_session}${msg.subject ? ` - ${msg.subject}` : ''}
# ${msg.body}
# Reply with: # ${commands.msgReply(msg.id, 'your response', sessionName)}`;

    // Send with delivery confirmation - wait for message to appear in session output before proceeding
    const delivered = await sendMessageWithConfirmation(sessionName, notification);

    if (!delivered) {
      console.warn(
        `Failed to confirm delivery of message ${msg.id} to ${sessionName} after retries`
      );
      // Continue to next message even if delivery not confirmed to avoid blocking the manager
    }

    // Small delay between messages to allow recipient time to read
    await new Promise(resolve => setTimeout(resolve, MESSAGE_FORWARD_DELAY_MS));
  }
}

// autoMergeApprovedPRs moved to src/utils/auto-merge.ts for reuse in pr.ts
