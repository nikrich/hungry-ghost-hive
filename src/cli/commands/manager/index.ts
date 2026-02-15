// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { execa } from 'execa';
import { join } from 'path';
import { ClusterRuntime, fetchLocalClusterStatus } from '../../../cluster/runtime.js';
import { loadConfig } from '../../../config/loader.js';
import type { HiveConfig } from '../../../config/schema.js';
import {
  syncFromProvider,
  syncStatusForStory,
} from '../../../connectors/project-management/operations.js';
import type { StoryRow } from '../../../db/client.js';
import { queryAll, withTransaction } from '../../../db/client.js';
import { acquireLock } from '../../../db/lock.js';
import { getAgentById, getAllAgents } from '../../../db/queries/agents.js';
import { getPendingEscalations, updateEscalation } from '../../../db/queries/escalations.js';
import { createLog } from '../../../db/queries/logs.js';
import {
  getAllPendingMessages,
  markMessagesRead,
  type MessageRow,
} from '../../../db/queries/messages.js';
import {
  backfillGithubPrNumbers,
  createPullRequest,
  getMergeQueue,
  getOpenPullRequestsByStory,
  getPullRequestsByStatus,
  updatePullRequest,
} from '../../../db/queries/pull-requests.js';
import { getStoriesByStatus, updateStory } from '../../../db/queries/stories.js';
import { Scheduler } from '../../../orchestrator/scheduler.js';
import { AgentState } from '../../../state-detectors/types.js';
import {
  captureTmuxPane,
  getHiveSessions,
  isManagerRunning,
  isTmuxSessionRunning,
  killTmuxSession,
  sendEnterToTmuxSession,
  sendToTmuxSession,
  stopManager as stopManagerSession,
} from '../../../tmux/manager.js';
import { autoMergeApprovedPRs } from '../../../utils/auto-merge.js';
import type { CLITool } from '../../../utils/cli-commands.js';
import {
  closeStaleGitHubPRs,
  syncAllTeamOpenPRs,
  syncMergedPRsFromGitHub,
} from '../../../utils/pr-sync.js';
import { withHiveContext, withHiveRoot } from '../../../utils/with-hive-context.js';
import {
  agentStates,
  detectAgentState,
  enforceBypassMode,
  forwardMessages,
  getAgentSafetyMode,
  handlePermissionPrompt,
  handlePlanApproval,
  nudgeAgent,
  updateAgentStateTracking,
} from './agent-monitoring.js';
import { handleEscalationAndNudge } from './escalation-handler.js';
import { handleStalledPlanningHandoff } from './handoff-recovery.js';
import { shouldAutoResolveOrphanedManagerEscalation } from './orphaned-escalations.js';
import { findSessionForAgent } from './session-resolution.js';
import { spinDownIdleAgents, spinDownMergedAgents } from './spin-down.js';
import { findStaleSessionEscalations } from './stale-escalations.js';
import type { ManagerCheckContext } from './types.js';
import { TMUX_CAPTURE_LINES, TMUX_CAPTURE_LINES_SHORT } from './types.js';

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
        rootDir: root,
        saveFn: () => db.save(),
        hiveConfig: config,
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
        rootDir: root,
        saveFn: () => db.save(),
        hiveConfig: config,
      }),
      hiveSessions: [],
      counters: {
        nudged: 0,
        autoProgressed: 0,
        messagesForwarded: 0,
        escalationsCreated: 0,
        escalationsResolved: 0,
        queuedPRCount: 0,
        handoffPromoted: 0,
        handoffAutoAssigned: 0,
        jiraSynced: 0,
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
    await syncJiraStatuses(ctx);
    await handleStalledPlanningHandoff(ctx);

    // Discover active tmux sessions
    const sessions = await getHiveSessions();
    ctx.hiveSessions = sessions.filter(s => s.name.startsWith('hive-'));
    resolveOrphanedSessionEscalations(ctx);

    prepareSessionData(ctx);
    resolveStaleEscalations(ctx);

    if (ctx.hiveSessions.length === 0) {
      console.log(chalk.gray('  No agent sessions found'));
      return;
    }

    await scanAgentSessions(ctx);
    batchMarkMessagesRead(ctx);
    await notifyQAOfQueuedPRs(ctx);
    await handleRejectedPRs(ctx);
    await recoverUnassignedQAFailedStories(ctx);
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
  const recoveredStoryIds = [...healthResult.revived, ...healthResult.orphanedRecovered];

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

  // If health/orphan recovery returned stories to planned, immediately re-assign
  // so the queue does not stall waiting for a manual `hive assign`.
  if (recoveredStoryIds.length > 0) {
    const assignmentResult = await ctx.scheduler.assignStories();
    ctx.db.save();

    if (assignmentResult.assigned > 0) {
      await ctx.scheduler.flushJiraQueue();
      ctx.db.save();
      console.log(
        chalk.green(
          `  Recovered ${recoveredStoryIds.length} story(ies), auto-assigned ${assignmentResult.assigned}`
        )
      );
    }

    if (assignmentResult.errors.length > 0) {
      console.log(
        chalk.yellow(
          `  Assignment errors during health recovery: ${assignmentResult.errors.length}`
        )
      );
    }
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

async function syncJiraStatuses(ctx: ManagerCheckContext): Promise<void> {
  const syncedStories = await syncFromProvider(ctx.root, ctx.db.db);
  if (syncedStories > 0) {
    ctx.counters.jiraSynced = syncedStories;
    console.log(chalk.cyan(`  Synced ${syncedStories} story status(es) from Jira`));
  }
  // Always save after Jira sync — syncFromJira now also pushes unsynced stories TO Jira
  ctx.db.save();
}

function prepareSessionData(ctx: ManagerCheckContext): void {
  // Pre-populate escalation dedup set
  const existingEscalations = getPendingEscalations(ctx.db.db);
  ctx.escalatedSessions = new Set(
    existingEscalations.filter(e => e.from_agent_id).map(e => e.from_agent_id)
  );

  // Batch fetch all agents and index by session name
  const allAgents = getAllAgents(ctx.db.db);
  const bySessionName = new Map<string, (typeof allAgents)[number]>();
  for (const agent of allAgents) {
    bySessionName.set(`hive-${agent.id}`, agent);
    if (agent.tmux_session) {
      bySessionName.set(agent.tmux_session, agent);
    }
  }
  ctx.agentsBySessionName = bySessionName;
}

function resolveStaleEscalations(ctx: ManagerCheckContext): void {
  const staleAfterMs = Math.max(
    1,
    ctx.config.manager.nudge_cooldown_ms,
    ctx.config.manager.stuck_threshold_ms
  );
  const pendingEscalations = getPendingEscalations(ctx.db.db);
  if (pendingEscalations.length === 0) return;

  const uniqueAgents = new Map<string, ReturnType<typeof getAllAgents>[number]>();
  for (const agent of ctx.agentsBySessionName.values()) {
    uniqueAgents.set(agent.id, agent);
  }

  const staleEscalations = findStaleSessionEscalations({
    pendingEscalations,
    agents: [...uniqueAgents.values()],
    liveSessionNames: new Set(ctx.hiveSessions.map(session => session.name)),
    nowMs: Date.now(),
    staleAfterMs,
  });

  if (staleEscalations.length === 0) return;

  withTransaction(ctx.db.db, () => {
    for (const stale of staleEscalations) {
      updateEscalation(ctx.db.db, stale.escalation.id, {
        status: 'resolved',
        resolution: `Manager auto-resolved stale escalation: ${stale.reason}`,
      });
      if (stale.escalation.from_agent_id) {
        ctx.escalatedSessions.delete(stale.escalation.from_agent_id);
      }
      ctx.counters.escalationsResolved++;
      createLog(ctx.db.db, {
        agentId: 'manager',
        storyId: stale.escalation.story_id || undefined,
        eventType: 'ESCALATION_RESOLVED',
        message: `Auto-resolved stale escalation ${stale.escalation.id}`,
        metadata: {
          escalation_id: stale.escalation.id,
          from_agent_id: stale.escalation.from_agent_id,
          reason: stale.reason,
        },
      });
    }
  });

  ctx.db.save();
  console.log(chalk.yellow(`  Auto-cleared ${staleEscalations.length} stale escalation(s)`));
}

function resolveOrphanedSessionEscalations(ctx: ManagerCheckContext): void {
  const pendingEscalations = getPendingEscalations(ctx.db.db);
  if (pendingEscalations.length === 0) {
    return;
  }

  const activeSessionNames = new Set(ctx.hiveSessions.map(session => session.name));
  const agentStatusBySessionName = new Map<string, string>();
  for (const agent of getAllAgents(ctx.db.db)) {
    if (agent.tmux_session) {
      agentStatusBySessionName.set(agent.tmux_session, agent.status);
    }
  }

  let resolvedCount = 0;
  for (const escalation of pendingEscalations) {
    const fromSession = escalation.from_agent_id;
    if (
      !shouldAutoResolveOrphanedManagerEscalation(
        fromSession,
        activeSessionNames,
        agentStatusBySessionName
      )
    ) {
      continue;
    }

    updateEscalation(ctx.db.db, escalation.id, {
      status: 'resolved',
      resolution: `Manager auto-resolved stale escalation from inactive session ${fromSession}`,
    });
    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId: escalation.story_id || undefined,
      eventType: 'ESCALATION_RESOLVED',
      message: `Auto-resolved stale escalation ${escalation.id} from inactive session ${fromSession}`,
      metadata: {
        escalation_id: escalation.id,
        from_agent_id: fromSession,
        recovery: 'orphaned_session_escalation',
      },
    });
    resolvedCount++;
  }

  if (resolvedCount > 0) {
    ctx.counters.escalationsResolved += resolvedCount;
    ctx.db.save();
    console.log(
      chalk.green(`  AUTO-RESOLVED: ${resolvedCount} stale escalation(s) from inactive sessions`)
    );
  }
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

    await handleEscalationAndNudge(
      ctx,
      session.name,
      agent,
      stateResult,
      agentCliTool,
      output,
      now
    );
  }
}

function batchMarkMessagesRead(ctx: ManagerCheckContext): void {
  if (ctx.messagesToMarkRead.length > 0) {
    markMessagesRead(ctx.db.db, ctx.messagesToMarkRead);
    ctx.db.save();
  }
}

async function notifyQAOfQueuedPRs(ctx: ManagerCheckContext): Promise<void> {
  const openPRs = getMergeQueue(ctx.db.db);
  ctx.counters.queuedPRCount = openPRs.length;

  const queuedPRs = openPRs.filter(pr => pr.status === 'queued');
  if (queuedPRs.length === 0) {
    return;
  }

  const reviewingSessions = new Set(
    openPRs
      .filter(pr => pr.status === 'reviewing' && pr.reviewed_by)
      .map(pr => pr.reviewed_by as string)
  );

  const idleQASessions = ctx.hiveSessions.filter(session => {
    if (!session.name.includes('-qa-')) return false;
    if (reviewingSessions.has(session.name)) return false;
    const agent = ctx.agentsBySessionName.get(session.name);
    return Boolean(agent && agent.status === 'idle');
  });

  let dispatchCount = 0;
  for (const qa of idleQASessions) {
    const nextPR = queuedPRs[dispatchCount];
    if (!nextPR) break;

    await withTransaction(ctx.db.db, () => {
      updatePullRequest(ctx.db.db, nextPR.id, {
        status: 'reviewing',
        reviewedBy: qa.name,
      });
      createLog(ctx.db.db, {
        agentId: qa.name,
        storyId: nextPR.story_id || undefined,
        eventType: 'PR_REVIEW_STARTED',
        message: `Manager assigned PR review: ${nextPR.id}`,
        metadata: { pr_id: nextPR.id, branch: nextPR.branch_name },
      });
    });
    dispatchCount++;
    ctx.db.save();

    const githubLine = nextPR.github_pr_url ? `\n# GitHub: ${nextPR.github_pr_url}` : '';
    await sendToTmuxSession(
      qa.name,
      `# You are assigned PR review ${nextPR.id} (${nextPR.story_id || 'no-story'}).${githubLine}
# Execute now:
#   hive pr show ${nextPR.id}
#   hive pr approve ${nextPR.id}
# (If manual merge is required in this repo, use --no-merge.)
# or reject:
#   hive pr reject ${nextPR.id} -r "reason"`
    );
  }

  // Fallback nudge if PRs are still queued but all QA sessions are busy/unavailable.
  if (dispatchCount === 0) {
    const qaSessions = ctx.hiveSessions.filter(s => s.name.includes('-qa-'));
    for (const qa of qaSessions) {
      await sendToTmuxSession(
        qa.name,
        `# ${queuedPRs.length} PR(s) waiting in queue. Run: hive pr queue`
      );
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

      // Sync status change to Jira
      await syncStatusForStory(ctx.root, ctx.db.db, storyId, 'qa_failed');
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

    const agentSession = findSessionForAgent(ctx.hiveSessions, agent);
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

async function recoverUnassignedQAFailedStories(ctx: ManagerCheckContext): Promise<void> {
  const recoverableStories = queryAll<StoryRow>(
    ctx.db.db,
    `
    SELECT * FROM stories
    WHERE status = 'qa_failed'
      AND assigned_agent_id IS NULL
  `
  );

  if (recoverableStories.length === 0) return;

  await withTransaction(ctx.db.db, () => {
    for (const story of recoverableStories) {
      updateStory(ctx.db.db, story.id, { status: 'planned', assignedAgentId: null });
      createLog(ctx.db.db, {
        agentId: 'manager',
        storyId: story.id,
        eventType: 'ORPHANED_STORY_RECOVERED',
        message: `Recovered QA-failed story ${story.id} (unassigned) back to planned`,
        metadata: { from_status: 'qa_failed', to_status: 'planned' },
      });
    }
  });
  ctx.db.save();

  for (const story of recoverableStories) {
    await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'planned');
  }

  // Proactively re-assign recovered work so it does not stall until manual `hive assign`.
  const assignmentResult = await ctx.scheduler.assignStories();
  ctx.db.save();

  if (assignmentResult.assigned > 0) {
    await ctx.scheduler.flushJiraQueue();
    ctx.db.save();
  }

  console.log(
    chalk.yellow(
      `  Recovered ${recoverableStories.length} QA-failed unassigned story(ies), assigned ${assignmentResult.assigned}`
    )
  );
  if (assignmentResult.errors.length > 0) {
    console.log(
      chalk.yellow(
        `  Assignment errors during QA-failed recovery: ${assignmentResult.errors.length}`
      )
    );
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

    const agent = getAgentById(ctx.db.db, story.assigned_agent_id);
    if (!agent) continue;

    const agentSession = findSessionForAgent(ctx.hiveSessions, agent);
    if (!agentSession) continue;
    const now = Date.now();

    const trackedState = agentStates.get(agentSession.name);
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
      continue;
    }
    if (trackedState && now - trackedState.lastNudgeTime < ctx.config.manager.nudge_cooldown_ms) {
      continue;
    }

    const agentCliTool = (agent.cli_tool || 'claude') as CLITool;
    const output = await captureTmuxPane(agentSession.name, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, agentCliTool);
    if (stateResult.needsHuman) {
      continue;
    }
    if (!stateResult.isWaiting || stateResult.state === AgentState.THINKING) {
      continue;
    }

    const canAutoProgress =
      stateResult.state === AgentState.WORK_COMPLETE || stateResult.state === AgentState.IDLE_AT_PROMPT;
    if (canAutoProgress) {
      const openPRs = getOpenPullRequestsByStory(ctx.db.db, story.id);
      if (openPRs.length > 0) {
        if (story.status !== 'pr_submitted') {
          updateStory(ctx.db.db, story.id, { status: 'pr_submitted' });
          ctx.db.save();
          await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'pr_submitted');
        }
        ctx.counters.autoProgressed++;
        continue;
      }

      const branch = await resolveStoryBranchName(ctx.root, story, agent);
      if (branch) {
        await withTransaction(ctx.db.db, () => {
          updateStory(ctx.db.db, story.id, { status: 'pr_submitted', branchName: branch });
          createPullRequest(ctx.db.db, {
            storyId: story.id,
            teamId: story.team_id || null,
            branchName: branch,
            submittedBy: agentSession.name,
          });
          createLog(ctx.db.db, {
            agentId: 'manager',
            storyId: story.id,
            eventType: 'PR_SUBMITTED',
            message: `Manager auto-progressed ${story.id} to PR queue`,
            metadata: {
              story_id: story.id,
              session_name: agentSession.name,
              branch,
              recovery: 'auto_progress_when_done',
            },
          });
        });
        ctx.db.save();
        await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'pr_submitted');
        await ctx.scheduler.checkMergeQueue();
        ctx.db.save();
        await sendToTmuxSession(
          agentSession.name,
          `# AUTO-PROGRESS: Manager detected ${story.id} as done and submitted it to merge queue on branch ${branch}.
# Check queue/status with: hive pr queue`
        );
        await sendEnterToTmuxSession(agentSession.name);
        ctx.counters.autoProgressed++;
        continue;
      }
    }

    await sendToTmuxSession(
      agentSession.name,
      `# REMINDER: Story ${story.id} has been in progress for a while.
# If stuck, escalate to your Senior or Tech Lead.
# If done, submit your PR: hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${story.id} --from ${agentSession.name}
# Then mark complete: hive my-stories complete ${story.id}`
    );
    await sendEnterToTmuxSession(agentSession.name);
    ctx.counters.nudged++;
    if (trackedState) {
      trackedState.lastNudgeTime = now;
    } else {
      agentStates.set(agentSession.name, {
        lastState: stateResult.state,
        lastStateChangeTime: now,
        lastNudgeTime: now,
      });
    }
  }
}

async function resolveStoryBranchName(
  root: string,
  story: StoryRow,
  agent: ReturnType<typeof getAllAgents>[number]
): Promise<string | null> {
  if (story.branch_name && story.branch_name.trim().length > 0) {
    return story.branch_name.trim();
  }

  if (!agent.worktree_path) return null;

  const worktreeDir = join(root, agent.worktree_path);
  try {
    const result = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreeDir });
    const branch = result.stdout.trim();
    if (!branch || branch === 'HEAD') {
      return null;
    }
    return branch;
  } catch {
    return null;
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
    autoProgressed,
    messagesForwarded,
    queuedPRCount,
    handoffPromoted,
    handoffAutoAssigned,
    jiraSynced,
  } = ctx.counters;
  const summary = [];

  if (escalationsCreated > 0) summary.push(`${escalationsCreated} escalations created`);
  if (escalationsResolved > 0) summary.push(`${escalationsResolved} escalations auto-resolved`);
  if (nudged > 0) summary.push(`${nudged} nudged`);
  if (autoProgressed > 0) summary.push(`${autoProgressed} auto-progressed`);
  if (messagesForwarded > 0) summary.push(`${messagesForwarded} messages forwarded`);
  if (queuedPRCount > 0) summary.push(`${queuedPRCount} PRs queued`);
  if (handoffPromoted > 0) summary.push(`${handoffPromoted} auto-promoted from estimated`);
  if (handoffAutoAssigned > 0) summary.push(`${handoffAutoAssigned} auto-assigned after recovery`);
  if (jiraSynced > 0) summary.push(`${jiraSynced} synced from Jira`);

  if (summary.length > 0) {
    console.log(chalk.yellow(`  ${summary.join(', ')}`));
  } else {
    console.log(chalk.green('  All agents productive'));
  }
}

// autoMergeApprovedPRs moved to src/utils/auto-merge.ts for reuse in pr.ts
