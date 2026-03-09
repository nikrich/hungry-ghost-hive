// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { createHash } from 'crypto';
import { ClusterRuntime, fetchLocalClusterStatus } from '../../../cluster/runtime.js';
import { loadConfig } from '../../../config/loader.js';
import type { HiveConfig } from '../../../config/schema.js';
import { syncFromProvider } from '../../../connectors/project-management/operations.js';
import type { StoryRow } from '../../../db/client.js';
import { queryAll, queryOne, withTransaction } from '../../../db/client.js';
import { acquireLock } from '../../../db/lock.js';
import { getAgentById, getAllAgents } from '../../../db/queries/agents.js';
import { getPendingEscalations, updateEscalation } from '../../../db/queries/escalations.js';
import { createLog } from '../../../db/queries/logs.js';
import {
  getAllPendingMessages,
  markMessagesRead,
  type MessageRow,
} from '../../../db/queries/messages.js';
import { backfillGithubPrNumbers } from '../../../db/queries/pull-requests.js';
import { getStoryById } from '../../../db/queries/stories.js';
import { Scheduler } from '../../../orchestrator/scheduler.js';
import { AgentState } from '../../../state-detectors/types.js';
import {
  captureTmuxPane,
  getHiveSessions,
  getManagerSession,
  isManagerRunning,
  isTmuxSessionRunning,
  killTmuxSession,
  stopManager as stopManagerSession,
} from '../../../tmux/manager.js';
import type { WithLockFn } from '../../../utils/auto-merge.js';
import { autoMergeApprovedPRs } from '../../../utils/auto-merge.js';
import type { CLITool } from '../../../utils/cli-commands.js';
import { getManagerLockPath, getTechLeadSessionName } from '../../../utils/instance.js';
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
import { spawnAuditorIfNeeded } from './auditor-lifecycle.js';
import { autoAssignPlannedStories } from './auto-assignment.js';
import { assessCompletionFromOutput } from './done-intelligence.js';
import { handleEscalationAndNudge } from './escalation-handler.js';
import { checkFeatureSignOff } from './feature-sign-off.js';
import { checkFeatureTestResult } from './feature-test-result.js';
import { handleStalledPlanningHandoff } from './handoff-recovery.js';
import {
  formatDuration,
  getMaxStuckNudgesPerStory,
  getScreenStaticInactivityThresholdMs,
  sendManagerNudge,
  verboseLog,
  verboseLogCtx,
} from './manager-utils.js';
import { shouldAutoResolveOrphanedManagerEscalation } from './orphaned-escalations.js';
import {
  closeStalePRs,
  reconcileAgentsOnMergedStories,
  recoverStaleReviewingPRs,
  syncMergedPRs,
  syncOpenPRs,
} from './pr-sync-orchestrator.js';
import {
  autoRejectCommentOnlyReviews,
  handleRejectedPRs,
  notifyQAOfQueuedPRs,
} from './qa-review-handler.js';
import { spinDownIdleAgents, spinDownMergedAgents } from './spin-down.js';
import { findStaleSessionEscalations } from './stale-escalations.js';
import {
  applyHumanInterventionStateOverride,
  clearHumanIntervention,
  isClassifierTimeoutReason,
  markClassifierTimeoutForHumanIntervention,
  markDoneFalseForHumanIntervention,
  screenStaticBySession,
  type ScreenStaticTracking,
} from './stuck-story-helpers.js';
import {
  autoProgressDoneStory,
  nudgeQAFailedStories,
  nudgeStuckStories,
  recoverUnassignedQAFailedStories,
} from './stuck-story-processor.js';
import { restartStaleTechLead } from './tech-lead-lifecycle.js';
import type { ManagerCheckContext } from './types.js';
import {
  MANAGER_NUDGE_END_MARKER,
  MANAGER_NUDGE_START_MARKER,
  TMUX_CAPTURE_LINES,
  TMUX_CAPTURE_LINES_SHORT,
} from './types.js';

// Re-export functions that moved to submodules (preserves public API for tests/consumers)
export { autoRejectCommentOnlyReviews } from './qa-review-handler.js';
export {
  shouldDeferStuckReminderUntilStaticWindow,
  shouldTreatUnknownAsStuckWaiting,
} from './stuck-story-helpers.js';

const DONE_INFERENCE_CONFIDENCE_THRESHOLD = 0.82;
const SCREEN_STATIC_AI_RECHECK_MS = 5 * 60 * 1000;
interface ScreenStaticStatus {
  changed: boolean;
  unchangedForMs: number;
  stuckDetectionInMs: number;
  fullAiDetectionInMs: number;
  shouldRunFullAiDetection: boolean;
}

interface NoActionSummarySnapshot {
  pendingEscalations: number;
  pendingActionableStories: number;
  activeWorkerAgents: number;
  workingWorkerAgents: number;
  liveWorkingSessions: number;
}

interface SummaryLine {
  color: 'green' | 'yellow' | 'red' | 'gray';
  message: string;
}

export function classifyNoActionSummary(snapshot: NoActionSummarySnapshot): SummaryLine {
  if (snapshot.pendingEscalations > 0) {
    return {
      color: 'yellow',
      message: `${snapshot.pendingEscalations} pending escalation(s)`,
    };
  }

  if (
    snapshot.pendingActionableStories > 0 &&
    (snapshot.workingWorkerAgents === 0 || snapshot.liveWorkingSessions === 0)
  ) {
    return {
      color: 'red',
      message: `${snapshot.pendingActionableStories} actionable story(ies), ${snapshot.workingWorkerAgents} working agent(s), ${snapshot.liveWorkingSessions} live working session(s), ${snapshot.activeWorkerAgents} total active agent(s)`,
    };
  }

  if (snapshot.pendingActionableStories === 0 && snapshot.activeWorkerAgents === 0) {
    return {
      color: 'gray',
      message: 'No pending work and no active worker agents',
    };
  }

  return { color: 'green', message: 'All agents productive' };
}

function summarizeOutputForVerbose(output: string): string {
  const compact = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(-3)
    .join(' | ');
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
}

function buildOutputFingerprint(output: string): string {
  return createHash('sha256').update(output).digest('hex');
}

function stripManagerNudgeBlocks(output: string): string {
  const lines = output.split('\n');
  const filtered: string[] = [];
  let inManagerBlock = false;

  for (const line of lines) {
    const normalized = line.replace(/^\s*(?:›|>)\s*/, '').trim();

    if (normalized.includes(MANAGER_NUDGE_START_MARKER)) {
      inManagerBlock = true;
      continue;
    }
    if (normalized.includes(MANAGER_NUDGE_END_MARKER)) {
      inManagerBlock = false;
      continue;
    }
    if (inManagerBlock) {
      continue;
    }
    filtered.push(line);
  }

  return filtered.join('\n');
}

function updateScreenStaticTracking(
  sessionName: string,
  output: string,
  nowMs: number,
  staticInactivityThresholdMs: number
): ScreenStaticStatus {
  const fingerprint = buildOutputFingerprint(stripManagerNudgeBlocks(output));
  const existing = screenStaticBySession.get(sessionName);

  let tracking: ScreenStaticTracking;
  let changed = false;
  if (!existing || existing.fingerprint !== fingerprint) {
    changed = true;
    tracking = {
      fingerprint,
      unchangedSinceMs: nowMs,
      lastAiAssessmentMs: 0,
    };
    screenStaticBySession.set(sessionName, tracking);
  } else {
    tracking = existing;
  }

  const unchangedForMs = nowMs - tracking.unchangedSinceMs;
  const stuckDetectionInMs = Math.max(0, staticInactivityThresholdMs - unchangedForMs);
  const fullAiDetectionInMs =
    unchangedForMs < staticInactivityThresholdMs
      ? stuckDetectionInMs
      : Math.max(0, SCREEN_STATIC_AI_RECHECK_MS - (nowMs - tracking.lastAiAssessmentMs));
  const shouldRunFullAiDetection =
    unchangedForMs >= staticInactivityThresholdMs &&
    (tracking.lastAiAssessmentMs === 0 ||
      nowMs - tracking.lastAiAssessmentMs >= SCREEN_STATIC_AI_RECHECK_MS);

  return {
    changed,
    unchangedForMs,
    stuckDetectionInMs,
    fullAiDetectionInMs,
    shouldRunFullAiDetection,
  };
}

function markFullAiDetectionRun(sessionName: string, nowMs: number): void {
  const tracking = screenStaticBySession.get(sessionName);
  if (!tracking) return;
  tracking.lastAiAssessmentMs = nowMs;
}

export const managerCommand = new Command('manager').description(
  'Micromanager daemon that keeps agents productive'
);

// Start the manager daemon
managerCommand
  .command('start')
  .description('Start the manager daemon (runs every 60s)')
  .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
  .option('-v, --verbose', 'Show detailed manager check logs (default: true)')
  .option('--no-verbose', 'Suppress verbose manager check logs')
  .option('--once', 'Run once and exit')
  .action(async (options: { interval: string; verbose?: boolean; once?: boolean }) => {
    const { root, paths } = withHiveRoot(ctx => ctx);

    // Load config first to get all settings
    const config = loadConfig(paths.hiveDir);
    let clusterRuntime: ClusterRuntime | null = null;

    const lockPath = getManagerLockPath(paths.hiveDir);

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

    const verbose = options.verbose !== false;
    let checkInProgress = false;
    let checkQueued = false;

    const runCheck = async (): Promise<void> => {
      if (checkInProgress) {
        checkQueued = true;
        verboseLog(verbose, 'managerCheck: skip=already_running queued=true');
        return;
      }

      checkInProgress = true;
      try {
        await managerCheck(root, config, clusterRuntime, verbose);
      } catch (err) {
        console.error(chalk.red('Manager error:'), err);
      } finally {
        checkInProgress = false;
        if (checkQueued) {
          checkQueued = false;
          void runCheck();
        }
      }
    };

    // Support two modes: legacy single-interval and new two-tier polling
    const useTwoTier = options.interval === '60' && config.manager;

    if (useTwoTier) {
      // Two-tier polling - use slow interval (60s) by default to reduce interruptions
      const slowInterval = config.cluster.enabled
        ? Math.min(config.manager.slow_poll_interval, config.cluster.sync_interval_ms)
        : config.manager.slow_poll_interval;
      console.log(chalk.cyan(`Manager started (polling every ${slowInterval / 1000}s)`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      await runCheck();

      if (!options.once) {
        setInterval(() => {
          void runCheck();
        }, slowInterval);
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

      await runCheck();

      if (!options.once) {
        setInterval(() => {
          void runCheck();
        }, interval);
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
  .option('-v, --verbose', 'Show detailed manager check logs (default: true)')
  .option('--no-verbose', 'Suppress verbose manager check logs')
  .action(async (options: { verbose?: boolean }) => {
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

    await managerCheck(root, config, undefined, options.verbose !== false);
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
    const { paths } = withHiveRoot(c => c);
    const managerSession = getManagerSession(paths.hiveDir);
    const running = await isManagerRunning(paths.hiveDir);
    if (running) {
      console.log(chalk.green(`Manager daemon is running (${managerSession} tmux session)`));
      console.log(chalk.gray(`To view: tmux attach -t ${managerSession}`));
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
    const { paths: stopPaths } = withHiveRoot(c => c);
    const stopped = await stopManagerSession(stopPaths.hiveDir);
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
  clusterRuntime?: ClusterRuntime | null,
  verbose = false
): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(chalk.gray(`[${timestamp}] Manager checking...`));

  const { paths } = withHiveRoot(c => c);

  // Load config if not provided (for backwards compatibility)
  if (!config) {
    config = loadConfig(paths.hiveDir);
  }

  // Cluster sync needs its own brief lock
  if (clusterRuntime?.isEnabled()) {
    const shouldSkip = await withHiveContext(async ({ db }) => {
      verboseLog(verbose, 'Cluster sync: start');
      const syncResult = await clusterRuntime.sync(db.db);
      if (!clusterRuntime.isLeader()) {
        const status = clusterRuntime.getStatus();
        const techLeadSession = getTechLeadSessionName(paths.hiveDir);
        if (await isTmuxSessionRunning(techLeadSession)) {
          await killTmuxSession(techLeadSession);
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
        verboseLog(verbose, 'Cluster sync: follower mode skip');
        return true;
      }

      const leaderStatus = clusterRuntime.getStatus();
      console.log(
        chalk.gray(`  Cluster leader mode (${leaderStatus.node_id}, term ${leaderStatus.term})`)
      );
      verboseLog(verbose, 'Cluster sync: leader mode ready');
      return false;
    });
    if (shouldSkip) return;
  }

  // Create the withDb helper — each call acquires its own short-lived lock
  const resolvedConfig = config;
  const withDb = async <T>(
    fn: (db: import('../../../db/client.js').DatabaseClient, scheduler: Scheduler) => Promise<T> | T
  ): Promise<T> => {
    return withHiveContext(async ({ db }) => {
      const scheduler = new Scheduler(db.db, {
        scaling: resolvedConfig.scaling,
        models: resolvedConfig.models,
        qa: resolvedConfig.qa,
        rootDir: root,
        saveFn: () => db.save(),
        hiveConfig: resolvedConfig,
      });
      return fn(db, scheduler);
    });
  };

  const ctx: ManagerCheckContext = {
    root,
    verbose,
    config,
    paths,
    withDb,
    hiveSessions: [],
    counters: {
      nudged: 0,
      nudgeEnterPresses: 0,
      nudgeEnterRetries: 0,
      nudgeSubmitUnconfirmed: 0,
      autoProgressed: 0,
      messagesForwarded: 0,
      escalationsCreated: 0,
      escalationsResolved: 0,
      queuedPRCount: 0,
      reviewingPRCount: 0,
      handoffPromoted: 0,
      handoffAutoAssigned: 0,
      plannedAutoAssigned: 0,
      jiraSynced: 0,
      featureTestsSpawned: 0,
      auditorsSpawned: 0,
    },
    escalatedSessions: new Set(),
    agentsBySessionName: new Map(),
    messagesToMarkRead: [],
  };

  verboseLogCtx(ctx, 'Step: backfill PR numbers');
  await backfillPRNumbers(ctx);
  verboseLogCtx(ctx, 'Step: health check');
  await runHealthCheck(ctx);
  verboseLogCtx(ctx, 'Step: merge queue check');
  await checkMergeQueue(ctx);
  verboseLogCtx(ctx, 'Step: auto-merge approved PRs');
  await runAutoMerge(ctx);
  verboseLogCtx(ctx, 'Step: sync merged PRs from GitHub');
  await syncMergedPRs(ctx);
  verboseLogCtx(ctx, 'Step: reconcile merged story agent pointers');
  await reconcileAgentsOnMergedStories(ctx);
  verboseLogCtx(ctx, 'Step: sync open PRs from GitHub');
  await syncOpenPRs(ctx);
  verboseLogCtx(ctx, 'Step: close stale PRs');
  await closeStalePRs(ctx);
  verboseLogCtx(ctx, 'Step: recover stale reviewing PRs');
  await recoverStaleReviewingPRs(ctx);
  verboseLogCtx(ctx, 'Step: sync Jira statuses');
  await syncJiraStatuses(ctx);
  verboseLogCtx(ctx, 'Step: planning handoff recovery');
  await handleStalledPlanningHandoff(ctx);
  verboseLogCtx(ctx, 'Step: restart stale tech lead');
  await restartStaleTechLead(ctx);
  verboseLogCtx(ctx, 'Step: auto-assign planned stories');
  await autoAssignPlannedStories(ctx);

  // Discover active tmux sessions
  verboseLogCtx(ctx, 'Step: discover hive tmux sessions');
  const sessions = await getHiveSessions(ctx.paths.hiveDir);
  ctx.hiveSessions = sessions;
  verboseLogCtx(ctx, `Discovered ${ctx.hiveSessions.length} hive session(s)`);
  await resolveOrphanedSessionEscalations(ctx);

  verboseLogCtx(ctx, 'Step: prepare session data');
  await prepareSessionData(ctx);
  verboseLogCtx(ctx, 'Step: resolve stale escalations');
  await resolveStaleEscalations(ctx);

  if (ctx.hiveSessions.length === 0) {
    console.log(chalk.gray('  No agent sessions found'));
    await printSummary(ctx);
    return;
  }

  verboseLogCtx(ctx, 'Step: scan agent sessions');
  await scanAgentSessions(ctx);
  verboseLogCtx(ctx, 'Step: mark forwarded messages as read');
  await batchMarkMessagesRead(ctx);
  verboseLogCtx(ctx, 'Step: notify QA about queued PRs');
  await notifyQAOfQueuedPRs(ctx);
  verboseLogCtx(ctx, 'Step: auto-reject comment-only reviews');
  await autoRejectCommentOnlyReviews(ctx);
  verboseLogCtx(ctx, 'Step: handle rejected PRs');
  await handleRejectedPRs(ctx);
  verboseLogCtx(ctx, 'Step: recover unassigned qa_failed stories');
  await recoverUnassignedQAFailedStories(ctx);
  verboseLogCtx(ctx, 'Step: nudge qa_failed stories');
  await nudgeQAFailedStories(ctx);
  verboseLogCtx(ctx, 'Step: spin down merged agents');
  await spinDownMergedAgents(ctx);
  verboseLogCtx(ctx, 'Step: check feature sign-off readiness');
  await checkFeatureSignOff(ctx);
  verboseLogCtx(ctx, 'Step: check feature test results');
  await checkFeatureTestResult(ctx);
  verboseLogCtx(ctx, 'Step: spin down idle agents');
  await spinDownIdleAgents(ctx);
  verboseLogCtx(ctx, 'Step: evaluate stuck stories');
  const auditorHandled = await spawnAuditorIfNeeded(ctx);
  if (!auditorHandled) {
    // auditor_enabled is false — fall back to existing nudge behavior
    await nudgeStuckStories(ctx);
  }
  verboseLogCtx(ctx, 'Step: notify seniors about unassigned stories');
  await notifyUnassignedStories(ctx);
  await printSummary(ctx);
}

async function backfillPRNumbers(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async db => {
    const backfilled = backfillGithubPrNumbers(db.db);
    verboseLogCtx(ctx, `backfillPRNumbers: backfilled=${backfilled}`);
    if (backfilled > 0) {
      console.log(chalk.yellow(`  Backfilled ${backfilled} PR(s) with github_pr_number from URL`));
      db.save();
    }
  });
}

async function runHealthCheck(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async (db, scheduler) => {
    const healthResult = await scheduler.healthCheck();
    verboseLogCtx(
      ctx,
      `runHealthCheck: terminated=${healthResult.terminated}, revived=${healthResult.revived.length}, orphanedRecovered=${healthResult.orphanedRecovered.length}`
    );
    const recoveredStoryIds = [...healthResult.revived, ...healthResult.orphanedRecovered];

    if (healthResult.terminated > 0) {
      console.log(
        chalk.yellow(`  Health check: ${healthResult.terminated} dead agent(s) cleaned up`)
      );
      if (healthResult.revived.length > 0) {
        console.log(
          chalk.yellow(`  Stories returned to queue: ${healthResult.revived.join(', ')}`)
        );
      }
      db.save();
    }

    if (healthResult.orphanedRecovered.length > 0) {
      console.log(
        chalk.green(
          `  Recovered ${healthResult.orphanedRecovered.length} orphaned story(ies): ${healthResult.orphanedRecovered.join(', ')}`
        )
      );
      db.save();
    }

    // If health/orphan recovery returned stories to planned, immediately re-assign
    // so the queue does not stall waiting for a manual `hive assign`.
    if (recoveredStoryIds.length > 0) {
      const assignmentResult = await scheduler.assignStories();
      verboseLogCtx(
        ctx,
        `runHealthCheck.assignStories: assigned=${assignmentResult.assigned}, errors=${assignmentResult.errors.length}`
      );
      db.save();

      if (assignmentResult.assigned > 0) {
        await scheduler.flushJiraQueue();
        db.save();
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
  });
}

async function checkMergeQueue(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async (db, scheduler) => {
    await scheduler.checkMergeQueue();
    verboseLogCtx(ctx, 'checkMergeQueue: completed');
    db.save();
  });
}

async function runAutoMerge(ctx: ManagerCheckContext): Promise<void> {
  const withLock: WithLockFn = async fn => ctx.withDb(async db => fn(db));
  const autoMerged = await autoMergeApprovedPRs(ctx.root, null, withLock);
  verboseLogCtx(ctx, `runAutoMerge: merged=${autoMerged}`);
  if (autoMerged > 0) {
    console.log(chalk.green(`  Auto-merged ${autoMerged} approved PR(s)`));
  }
}

// syncMergedPRs, reconcileAgentsOnMergedStories, syncOpenPRs, closeStalePRs,
// recoverStaleReviewingPRs moved to ./pr-sync-orchestrator.ts

async function syncJiraStatuses(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async db => {
    const syncedStories = await syncFromProvider(ctx.root, db.db);
    verboseLogCtx(ctx, `syncJiraStatuses: synced=${syncedStories}`);
    if (syncedStories > 0) {
      ctx.counters.jiraSynced = syncedStories;
      console.log(chalk.cyan(`  Synced ${syncedStories} story status(es) from Jira`));
    }
    // Always save after Jira sync — syncFromJira now also pushes unsynced stories TO Jira
    db.save();
  });
}

async function prepareSessionData(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async db => {
    // Pre-populate escalation dedup set
    const existingEscalations = getPendingEscalations(db.db);
    ctx.escalatedSessions = new Set(
      existingEscalations.filter(e => e.from_agent_id).map(e => e.from_agent_id)
    );

    // Batch fetch all agents and index by session name
    const allAgents = getAllAgents(db.db);
    const bySessionName = new Map<string, (typeof allAgents)[number]>();
    for (const agent of allAgents) {
      bySessionName.set(`hive-${agent.id}`, agent);
      if (agent.tmux_session) {
        bySessionName.set(agent.tmux_session, agent);
      }
    }
    ctx.agentsBySessionName = bySessionName;
    verboseLogCtx(
      ctx,
      `prepareSessionData: escalations=${existingEscalations.length}, agentsIndexed=${bySessionName.size}`
    );
  });
}

async function resolveStaleEscalations(ctx: ManagerCheckContext): Promise<void> {
  await ctx.withDb(async db => {
    const staleAfterMs = Math.max(
      1,
      ctx.config.manager.nudge_cooldown_ms,
      ctx.config.manager.stuck_threshold_ms
    );
    const pendingEscalations = getPendingEscalations(db.db);
    verboseLogCtx(
      ctx,
      `resolveStaleEscalations: pending=${pendingEscalations.length}, staleAfterMs=${staleAfterMs}`
    );
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
    verboseLogCtx(ctx, `resolveStaleEscalations: stale=${staleEscalations.length}`);

    withTransaction(
      db.db,
      () => {
        for (const stale of staleEscalations) {
          updateEscalation(db.db, stale.escalation.id, {
            status: 'resolved',
            resolution: `Manager auto-resolved stale escalation: ${stale.reason}`,
          });
          if (stale.escalation.from_agent_id) {
            ctx.escalatedSessions.delete(stale.escalation.from_agent_id);
          }
          ctx.counters.escalationsResolved++;
          createLog(db.db, {
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
      },
      () => db.save()
    );
    console.log(chalk.yellow(`  Auto-cleared ${staleEscalations.length} stale escalation(s)`));
  });
}

async function resolveOrphanedSessionEscalations(ctx: ManagerCheckContext): Promise<void> {
  const resolvedCount = await ctx.withDb(async db => {
    const pendingEscalations = getPendingEscalations(db.db);
    verboseLogCtx(ctx, `resolveOrphanedSessionEscalations: pending=${pendingEscalations.length}`);
    if (pendingEscalations.length === 0) {
      return 0;
    }

    const activeSessionNames = new Set(ctx.hiveSessions.map(session => session.name));
    const agentStatusBySessionName = new Map<string, string>();
    for (const agent of getAllAgents(db.db)) {
      if (agent.tmux_session) {
        agentStatusBySessionName.set(agent.tmux_session, agent.status);
      }
    }

    let count = 0;
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

      updateEscalation(db.db, escalation.id, {
        status: 'resolved',
        resolution: `Manager auto-resolved stale escalation from inactive session ${fromSession}`,
      });
      createLog(db.db, {
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
      count++;
    }

    if (count > 0) {
      ctx.counters.escalationsResolved += count;
      db.save();
    }
    return count;
  });

  if (resolvedCount > 0) {
    console.log(
      chalk.green(`  AUTO-RESOLVED: ${resolvedCount} stale escalation(s) from inactive sessions`)
    );
  }
  verboseLogCtx(ctx, `resolveOrphanedSessionEscalations: resolved=${resolvedCount}`);
}

async function scanAgentSessions(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Batch fetch pending messages (brief lock)
  const allPendingMessages = await ctx.withDb(async db => getAllPendingMessages(db.db));
  const messagesBySessionName = new Map<string, MessageRow[]>();
  const activeSessionNames = new Set<string>();
  const maxStuckNudgesPerStory = getMaxStuckNudgesPerStory(ctx.config);

  for (const msg of allPendingMessages) {
    if (!messagesBySessionName.has(msg.to_session)) {
      messagesBySessionName.set(msg.to_session, []);
    }
    messagesBySessionName.get(msg.to_session)!.push(msg);
  }

  // Phase 2: Per-session processing (tmux/AI outside lock, DB writes under brief locks)
  for (const session of ctx.hiveSessions) {
    if (session.name === getManagerSession(ctx.paths.hiveDir)) continue;

    const agent = ctx.agentsBySessionName.get(session.name);

    // Skip sessions not registered in our DB (cross-project sessions).
    // This prevents escalation noise from sessions belonging to other
    // teams/projects sharing the same tmux server.
    if (!agent) {
      verboseLogCtx(ctx, `Skipping ${session.name}: no agent registered in DB (cross-project)`);
      continue;
    }

    activeSessionNames.add(session.name);
    const agentCliTool = (agent.cli_tool || 'claude') as CLITool;
    const safetyMode = getAgentSafetyMode(ctx.config, agent);
    verboseLogCtx(
      ctx,
      `Agent check: ${session.name} (cli=${agentCliTool}, safety=${safetyMode}, story=${agent?.current_story_id || '-'})`
    );

    // Forward unread messages (tmux I/O, no lock needed)
    const unread = messagesBySessionName.get(session.name) || [];
    if (unread.length > 0) {
      verboseLogCtx(ctx, `Agent ${session.name}: forwarding ${unread.length} unread message(s)`);
      await forwardMessages(session.name, unread, agentCliTool);
      ctx.counters.messagesForwarded += unread.length;
      ctx.messagesToMarkRead.push(...unread.map(msg => msg.id));
    }

    const output = await captureTmuxPane(session.name, TMUX_CAPTURE_LINES);
    verboseLogCtx(
      ctx,
      `Agent ${session.name}: pane tail="${summarizeOutputForVerbose(output) || '(empty)'}"`
    );

    await enforceBypassMode(session.name, output, agentCliTool, safetyMode);

    let stateResult = detectAgentState(output, agentCliTool);
    const now = Date.now();
    stateResult = await applyHumanInterventionStateOverride(
      ctx,
      session.name,
      agent?.current_story_id || null,
      stateResult,
      agent?.id ?? null
    );
    const staticStatus = updateScreenStaticTracking(
      session.name,
      output,
      now,
      getScreenStaticInactivityThresholdMs(ctx.config)
    );
    verboseLogCtx(
      ctx,
      `Agent ${session.name}: state=${stateResult.state}, waiting=${stateResult.isWaiting}, needsHuman=${stateResult.needsHuman}, reason=${stateResult.reason}`
    );
    verboseLogCtx(
      ctx,
      `Agent ${session.name}: screen=${staticStatus.changed ? 'changed' : 'unchanged'} (${formatDuration(staticStatus.unchangedForMs)}), stuck-check=${formatDuration(staticStatus.stuckDetectionInMs)}, full-ai=${formatDuration(staticStatus.fullAiDetectionInMs)}`
    );

    updateAgentStateTracking(session.name, stateResult, now);
    if (!stateResult.isWaiting) {
      const tracked = agentStates.get(session.name);
      if (tracked && (tracked.storyStuckNudgeCount || 0) > 0) {
        tracked.storyStuckNudgeCount = 0;
      }
      clearHumanIntervention(session.name);
    }

    const handled = await handlePermissionPrompt(ctx, session.name, stateResult, safetyMode);
    if (handled) {
      verboseLogCtx(ctx, `Agent ${session.name}: auto-approved permission prompt`);
      continue;
    }

    await handlePlanApproval(session.name, stateResult, now, agentCliTool, safetyMode);

    const beforeNudged = ctx.counters.nudged;
    const beforeCreated = ctx.counters.escalationsCreated;
    const beforeResolved = ctx.counters.escalationsResolved;
    await handleEscalationAndNudge(
      ctx,
      session.name,
      agent,
      stateResult,
      agentCliTool,
      output,
      now
    );
    const actionNotes = [];
    if (ctx.counters.nudged > beforeNudged) actionNotes.push('nudged');
    if (ctx.counters.escalationsCreated > beforeCreated) actionNotes.push('escalation_created');
    if (ctx.counters.escalationsResolved > beforeResolved) actionNotes.push('escalation_resolved');

    if (
      actionNotes.length === 0 &&
      staticStatus.shouldRunFullAiDetection &&
      stateResult.isWaiting &&
      !stateResult.needsHuman
    ) {
      markFullAiDetectionRun(session.name, now);
      const storyId = agent?.current_story_id || null;
      if (!storyId) {
        verboseLogCtx(ctx, `Agent ${session.name}: full-ai skipped (no current story)`);
      } else {
        // Brief lock for story lookup
        const story = await ctx.withDb(async db => getStoryById(db.db, storyId));
        if (!story || ['merged', 'completed'].includes(story.status)) {
          verboseLogCtx(
            ctx,
            `Agent ${session.name}: full-ai skipped (story unavailable or closed: ${storyId})`
          );
        } else {
          // AI classifier (no lock needed)
          const completionAssessment = await assessCompletionFromOutput(
            ctx.config,
            session.name,
            storyId,
            output
          );
          verboseLogCtx(
            ctx,
            `Agent ${session.name}: full-ai result done=${completionAssessment.done}, confidence=${completionAssessment.confidence.toFixed(2)}, reason=${completionAssessment.reason}`
          );
          if (isClassifierTimeoutReason(completionAssessment.reason)) {
            await markClassifierTimeoutForHumanIntervention(
              ctx,
              session.name,
              storyId,
              completionAssessment.reason,
              agent?.id ?? null
            );
            actionNotes.push('classifier_timeout_escalation');
            verboseLogCtx(ctx, `Agent ${session.name}: action=classifier_timeout_escalation`);
            continue;
          }
          clearHumanIntervention(session.name);

          const aiSaysDone =
            completionAssessment.done &&
            completionAssessment.confidence >= DONE_INFERENCE_CONFIDENCE_THRESHOLD;

          if (aiSaysDone) {
            if (!agent) {
              verboseLogCtx(
                ctx,
                `Agent ${session.name}: full-ai done=true but auto-progress skipped (missing agent row)`
              );
            } else {
              const progressed = await autoProgressDoneStory(
                ctx,
                story,
                agent,
                session.name,
                completionAssessment.reason,
                completionAssessment.confidence
              );
              if (progressed) {
                ctx.counters.autoProgressed++;
                actionNotes.push('ai_auto_progressed');
              }
            }
          } else {
            const tracked = agentStates.get(session.name);
            const stuckNudgesSent = tracked?.storyStuckNudgeCount || 0;
            if (stuckNudgesSent >= maxStuckNudgesPerStory) {
              await markDoneFalseForHumanIntervention(
                ctx,
                session.name,
                storyId,
                completionAssessment.reason,
                agent?.id ?? null
              );
              verboseLogCtx(
                ctx,
                `Agent ${session.name}: full-ai nudge skipped (stuck nudge limit reached: ${stuckNudgesSent}/${maxStuckNudgesPerStory})`
              );
              actionNotes.push('done_false_escalation');
              verboseLogCtx(ctx, `Agent ${session.name}: action=done_false_escalation`);
              continue;
            }
            const shortReason = completionAssessment.reason.replace(/\s+/g, ' ').trim();
            await sendManagerNudge(
              ctx,
              session.name,
              `# STALLED OUTPUT DETECTED: your terminal output has not changed for ${formatDuration(staticStatus.unchangedForMs)}.
# AI assessment: ${shortReason}
# Stop repeating status updates. Execute the next concrete step now (tests, then PR submit if done).
# If complete, run:
#   hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${storyId} --from ${session.name}
#   hive my-stories complete ${storyId}`
            );
            ctx.counters.nudged++;
            actionNotes.push('ai_stall_nudge');
            if (tracked) {
              tracked.lastNudgeTime = now;
              tracked.storyStuckNudgeCount = (tracked.storyStuckNudgeCount || 0) + 1;
            } else {
              agentStates.set(session.name, {
                lastState: stateResult.state,
                lastStateChangeTime: now,
                lastNudgeTime: now,
                storyStuckNudgeCount: 1,
              });
            }
            // Brief lock for log write
            await ctx.withDb(async db => {
              createLog(db.db, {
                agentId: 'manager',
                storyId,
                eventType: 'STORY_PROGRESS_UPDATE',
                message: `AI stall analysis nudge for ${session.name}: ${shortReason}`,
                metadata: {
                  session_name: session.name,
                  unchanged_ms: staticStatus.unchangedForMs,
                  ai_done: completionAssessment.done,
                  ai_confidence: completionAssessment.confidence,
                },
              });
              db.save();
            });
          }
        }
      }
    } else if (staticStatus.shouldRunFullAiDetection && actionNotes.length > 0) {
      verboseLogCtx(
        ctx,
        `Agent ${session.name}: full-ai deferred (manager already took action=${actionNotes.join('+')})`
      );
    }

    verboseLogCtx(
      ctx,
      `Agent ${session.name}: action=${actionNotes.length > 0 ? actionNotes.join('+') : 'none'}`
    );
  }

  for (const sessionName of Array.from(screenStaticBySession.keys())) {
    if (!activeSessionNames.has(sessionName)) {
      screenStaticBySession.delete(sessionName);
    }
  }
}

async function batchMarkMessagesRead(ctx: ManagerCheckContext): Promise<void> {
  verboseLogCtx(ctx, `batchMarkMessagesRead: count=${ctx.messagesToMarkRead.length}`);
  if (ctx.messagesToMarkRead.length > 0) {
    await ctx.withDb(async db => {
      markMessagesRead(db.db, ctx.messagesToMarkRead);
      db.save();
    });
  }
}

// notifyQAOfQueuedPRs, autoRejectCommentOnlyReviews, handleRejectedPRs
// moved to ./qa-review-handler.ts

// nudgeQAFailedStories, recoverUnassignedQAFailedStories, nudgeStuckStories,
// autoProgressDoneStory, resolveStoryBranchName moved to ./stuck-story-processor.ts

async function notifyUnassignedStories(ctx: ManagerCheckContext): Promise<void> {
  // Phase 1: Read planned unassigned stories (brief lock)
  const plannedCount = await ctx.withDb(async db => {
    const plannedStories = queryAll<StoryRow>(
      db.db,
      "SELECT * FROM stories WHERE status = 'planned' AND assigned_agent_id IS NULL"
    );
    return plannedStories.length;
  });

  if (plannedCount === 0) return;
  verboseLogCtx(ctx, `notifyUnassignedStories: plannedUnassigned=${plannedCount}`);

  // Phase 2: Tmux captures and nudges (no lock needed)
  const seniorSessions = ctx.hiveSessions.filter(s => s.name.includes('-senior-'));
  verboseLogCtx(ctx, `notifyUnassignedStories: seniorSessions=${seniorSessions.length}`);
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
      verboseLogCtx(
        ctx,
        `notifyUnassignedStories: nudge ${senior.name} waiting=${stateResult.isWaiting} state=${stateResult.state}`
      );
      await sendManagerNudge(
        ctx,
        senior.name,
        `# ${plannedCount} unassigned story(ies). Run: hive my-stories ${senior.name} --all`
      );
    } else {
      verboseLogCtx(
        ctx,
        `notifyUnassignedStories: skip ${senior.name} waiting=${stateResult.isWaiting} needsHuman=${stateResult.needsHuman} state=${stateResult.state}`
      );
    }
  }
}

// restartStaleTechLead moved to ./tech-lead-lifecycle.ts

async function printSummary(ctx: ManagerCheckContext): Promise<void> {
  const {
    escalationsCreated,
    escalationsResolved,
    nudged,
    nudgeEnterPresses,
    nudgeEnterRetries,
    nudgeSubmitUnconfirmed,
    autoProgressed,
    messagesForwarded,
    queuedPRCount,
    reviewingPRCount,
    handoffPromoted,
    handoffAutoAssigned,
    plannedAutoAssigned,
    jiraSynced,
    featureTestsSpawned,
    auditorsSpawned,
  } = ctx.counters;
  const summary = [];

  if (escalationsCreated > 0) summary.push(`${escalationsCreated} escalations created`);
  if (escalationsResolved > 0) summary.push(`${escalationsResolved} escalations auto-resolved`);
  if (nudged > 0) summary.push(`${nudged} nudged`);
  if (nudgeEnterPresses > 0) {
    const retrySuffix = nudgeEnterRetries > 0 ? `, ${nudgeEnterRetries} retry Enter` : '';
    const confirmationSuffix =
      nudgeSubmitUnconfirmed > 0
        ? `, ${nudgeSubmitUnconfirmed} unconfirmed submit(s)`
        : ', all submits confirmed';
    summary.push(
      `nudge Enter proof: ${nudgeEnterPresses} keypress(es) after nudge${retrySuffix}${confirmationSuffix}`
    );
  }
  if (autoProgressed > 0) summary.push(`${autoProgressed} auto-progressed`);
  if (messagesForwarded > 0) summary.push(`${messagesForwarded} messages forwarded`);
  if (queuedPRCount > 0) summary.push(`${queuedPRCount} PRs queued`);
  if (reviewingPRCount > 0) summary.push(`${reviewingPRCount} PRs reviewing`);
  if (handoffPromoted > 0) summary.push(`${handoffPromoted} auto-promoted from estimated`);
  if (handoffAutoAssigned > 0) summary.push(`${handoffAutoAssigned} auto-assigned after recovery`);
  if (plannedAutoAssigned > 0)
    summary.push(`${plannedAutoAssigned} planned story(ies) auto-assigned`);
  if (jiraSynced > 0) summary.push(`${jiraSynced} synced from Jira`);
  if (featureTestsSpawned > 0) summary.push(`${featureTestsSpawned} feature test(s) spawned`);
  if (auditorsSpawned > 0) summary.push(`${auditorsSpawned} auditor(s) spawned`);

  if (summary.length > 0) {
    console.log(chalk.yellow(`  ${summary.join(', ')}`));
    return;
  }

  const noActionSnapshot = await ctx.withDb(async db => {
    const pendingEscalations =
      queryOne<{ count: number }>(
        db.db,
        "SELECT COUNT(*) AS count FROM escalations WHERE status = 'pending'"
      )?.count ?? 0;
    const pendingActionableStories =
      queryOne<{ count: number }>(
        db.db,
        "SELECT COUNT(*) AS count FROM stories WHERE status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')"
      )?.count ?? 0;
    const activeWorkerAgents =
      queryOne<{ count: number }>(
        db.db,
        "SELECT COUNT(*) AS count FROM agents WHERE type != 'tech_lead' AND status != 'terminated'"
      )?.count ?? 0;
    const workingWorkerAgents =
      queryOne<{ count: number }>(
        db.db,
        "SELECT COUNT(*) AS count FROM agents WHERE type != 'tech_lead' AND status = 'working'"
      )?.count ?? 0;

    return {
      pendingEscalations,
      pendingActionableStories,
      activeWorkerAgents,
      workingWorkerAgents,
      liveWorkingSessions: ctx.hiveSessions.filter(session => {
        const agent = ctx.agentsBySessionName.get(session.name);
        return Boolean(agent && agent.type !== 'tech_lead' && agent.status === 'working');
      }).length,
    };
  });
  const line = classifyNoActionSummary(noActionSnapshot);
  if (line.color === 'red') {
    console.log(chalk.red(`  ${line.message}`));
  } else if (line.color === 'yellow') {
    console.log(chalk.yellow(`  ${line.message}`));
  } else if (line.color === 'gray') {
    console.log(chalk.gray(`  ${line.message}`));
  } else {
    console.log(chalk.green(`  ${line.message}`));
  }
}

// autoMergeApprovedPRs moved to src/utils/auto-merge.ts for reuse in pr.ts
