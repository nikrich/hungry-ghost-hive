// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { createHash } from 'crypto';
import { execa } from 'execa';
import { join } from 'path';
import { getCliRuntimeBuilder, resolveRuntimeModelForCli } from '../../../cli-runtimes/index.js';
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
import {
  getAgentById,
  getAgentsByType,
  getAllAgents,
  updateAgent,
} from '../../../db/queries/agents.js';
import {
  createEscalation,
  getActiveEscalationsForAgent,
  getPendingEscalations,
  updateEscalation,
} from '../../../db/queries/escalations.js';
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
import { getStoriesByStatus, getStoryById, updateStory } from '../../../db/queries/stories.js';
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
  spawnTmuxSession,
  stopManager as stopManagerSession,
} from '../../../tmux/manager.js';
import { autoMergeApprovedPRs } from '../../../utils/auto-merge.js';
import type { CLITool } from '../../../utils/cli-commands.js';
import { findHiveRoot as findHiveRootFromDir, getHivePaths } from '../../../utils/paths.js';
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
  withManagerNudgeEnvelope,
} from './agent-monitoring.js';
import { assessCompletionFromOutput } from './done-intelligence.js';
import { handleEscalationAndNudge } from './escalation-handler.js';
import { checkFeatureSignOff } from './feature-sign-off.js';
import { checkFeatureTestResult } from './feature-test-result.js';
import { handleStalledPlanningHandoff } from './handoff-recovery.js';
import { shouldAutoResolveOrphanedManagerEscalation } from './orphaned-escalations.js';
import { findSessionForAgent } from './session-resolution.js';
import { spinDownIdleAgents, spinDownMergedAgents } from './spin-down.js';
import { findStaleSessionEscalations } from './stale-escalations.js';
import type { ManagerCheckContext } from './types.js';
import {
  MANAGER_NUDGE_END_MARKER,
  MANAGER_NUDGE_START_MARKER,
  TMUX_CAPTURE_LINES,
  TMUX_CAPTURE_LINES_SHORT,
} from './types.js';

const DONE_INFERENCE_CONFIDENCE_THRESHOLD = 0.82;
const SCREEN_STATIC_AI_RECHECK_MS = 5 * 60 * 1000;
const DEFAULT_SCREEN_STATIC_INACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;
const DEFAULT_MAX_STUCK_NUDGES_PER_STORY = 1;
const CLASSIFIER_TIMEOUT_REASON_PREFIX = 'Classifier timeout';
const AI_DONE_FALSE_REASON_PREFIX = 'AI done=false escalation';

interface ClassifierTimeoutIntervention {
  storyId: string;
  reason: string;
  createdAtMs: number;
}

interface ScreenStaticTracking {
  fingerprint: string;
  unchangedSinceMs: number;
  lastAiAssessmentMs: number;
}

interface ScreenStaticStatus {
  changed: boolean;
  unchangedForMs: number;
  stuckDetectionInMs: number;
  fullAiDetectionInMs: number;
  shouldRunFullAiDetection: boolean;
}

const screenStaticBySession = new Map<string, ScreenStaticTracking>();
const classifierTimeoutInterventionsBySession = new Map<string, ClassifierTimeoutIntervention>();
const aiDoneFalseInterventionsBySession = new Map<string, ClassifierTimeoutIntervention>();

function verboseLog(verbose: boolean, message: string): void {
  if (!verbose) return;
  console.log(chalk.gray(`  [verbose] ${message}`));
}

function verboseLogCtx(ctx: Pick<ManagerCheckContext, 'verbose'>, message: string): void {
  verboseLog(ctx.verbose, message);
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

function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
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

function getScreenStaticInactivityThresholdMs(config?: HiveConfig): number {
  return Math.max(
    1,
    config?.manager.screen_static_inactivity_threshold_ms ??
      DEFAULT_SCREEN_STATIC_INACTIVITY_THRESHOLD_MS
  );
}

function getMaxStuckNudgesPerStory(config?: HiveConfig): number {
  return Math.max(
    0,
    config?.manager.max_stuck_nudges_per_story ?? DEFAULT_MAX_STUCK_NUDGES_PER_STORY
  );
}

function isClassifierTimeoutReason(reason: string): boolean {
  return /local classifier unavailable:.*timed out|command timed out/i.test(reason);
}

function formatClassifierTimeoutEscalationReason(storyId: string, reason: string): string {
  const singleLine = reason.replace(/\s+/g, ' ').trim();
  const shortReason = singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
  return `${CLASSIFIER_TIMEOUT_REASON_PREFIX}: manager completion classifier timed out for ${storyId}. Manual human intervention required. Detail: ${shortReason}`;
}

function applyHumanInterventionStateOverride(
  ctx: ManagerCheckContext,
  sessionName: string,
  storyId: string | null,
  stateResult: ReturnType<typeof detectAgentState>
): ReturnType<typeof detectAgentState> {
  const timeoutIntervention = classifierTimeoutInterventionsBySession.get(sessionName);
  if (timeoutIntervention && (!storyId || storyId !== timeoutIntervention.storyId)) {
    classifierTimeoutInterventionsBySession.delete(sessionName);
  }
  const doneFalseIntervention = aiDoneFalseInterventionsBySession.get(sessionName);
  if (doneFalseIntervention && (!storyId || storyId !== doneFalseIntervention.storyId)) {
    aiDoneFalseInterventionsBySession.delete(sessionName);
  }

  const transientIntervention =
    [timeoutIntervention, doneFalseIntervention]
      .filter((candidate): candidate is ClassifierTimeoutIntervention =>
        Boolean(candidate && storyId && candidate.storyId === storyId)
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs)[0] ?? null;

  const persistedIntervention =
    storyId === null
      ? null
      : (getActiveEscalationsForAgent(ctx.db.db, sessionName).find(
          escalation =>
            escalation.story_id === storyId &&
            (escalation.reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX) ||
              escalation.reason.startsWith(AI_DONE_FALSE_REASON_PREFIX))
        ) ??
        getPendingEscalations(ctx.db.db).find(
          escalation =>
            escalation.story_id === storyId &&
            (escalation.reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX) ||
              escalation.reason.startsWith(AI_DONE_FALSE_REASON_PREFIX))
        ) ??
        null);

  const interventionReason = transientIntervention?.reason || persistedIntervention?.reason || null;

  if (!interventionReason) {
    return stateResult;
  }

  return {
    ...stateResult,
    state: AgentState.ASKING_QUESTION,
    needsHuman: true,
    isWaiting: true,
    reason: `Manual intervention required: ${interventionReason}`,
  };
}

function clearHumanIntervention(sessionName: string): void {
  classifierTimeoutInterventionsBySession.delete(sessionName);
  aiDoneFalseInterventionsBySession.delete(sessionName);
}

async function markClassifierTimeoutForHumanIntervention(
  ctx: ManagerCheckContext,
  sessionName: string,
  storyId: string,
  reason: string
): Promise<void> {
  const escalationReason = formatClassifierTimeoutEscalationReason(storyId, reason);
  classifierTimeoutInterventionsBySession.set(sessionName, {
    storyId,
    reason: escalationReason,
    createdAtMs: Date.now(),
  });

  const activeTimeoutEscalation = getActiveEscalationsForAgent(ctx.db.db, sessionName).some(
    escalation => escalation.reason.startsWith(CLASSIFIER_TIMEOUT_REASON_PREFIX)
  );
  if (!activeTimeoutEscalation) {
    const escalation = createEscalation(ctx.db.db, {
      storyId,
      fromAgentId: sessionName,
      toAgentId: null,
      reason: escalationReason,
    });
    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId,
      eventType: 'ESCALATION_CREATED',
      status: 'error',
      message: `${sessionName} requires human intervention: completion classifier timed out`,
      metadata: {
        escalation_id: escalation.id,
        session_name: sessionName,
        escalation_type: 'classifier_timeout',
      },
    });
    ctx.counters.escalationsCreated++;
    ctx.escalatedSessions.add(sessionName);
  }

  const tracked = agentStates.get(sessionName);
  if (tracked) {
    tracked.lastState = AgentState.ASKING_QUESTION;
    tracked.lastStateChangeTime = Date.now();
  }
}

function formatDoneFalseEscalationReason(storyId: string, reason: string): string {
  const singleLine = reason.replace(/\s+/g, ' ').trim();
  const shortReason = singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
  return `${AI_DONE_FALSE_REASON_PREFIX}: manager AI assessment returned done=false for ${storyId} after nudge limit reached. Manual human intervention required. Detail: ${shortReason}`;
}

async function markDoneFalseForHumanIntervention(
  ctx: ManagerCheckContext,
  sessionName: string,
  storyId: string,
  reason: string
): Promise<void> {
  const escalationReason = formatDoneFalseEscalationReason(storyId, reason);
  aiDoneFalseInterventionsBySession.set(sessionName, {
    storyId,
    reason: escalationReason,
    createdAtMs: Date.now(),
  });

  const hasActiveEscalation = getActiveEscalationsForAgent(ctx.db.db, sessionName).some(
    escalation => escalation.reason.startsWith(AI_DONE_FALSE_REASON_PREFIX)
  );
  if (!hasActiveEscalation) {
    const escalation = createEscalation(ctx.db.db, {
      storyId,
      fromAgentId: sessionName,
      toAgentId: null,
      reason: escalationReason,
    });
    createLog(ctx.db.db, {
      agentId: 'manager',
      storyId,
      eventType: 'ESCALATION_CREATED',
      status: 'error',
      message: `${sessionName} requires human intervention: AI assessment reports blocked/incomplete after nudge limit`,
      metadata: {
        escalation_id: escalation.id,
        session_name: sessionName,
        escalation_type: 'ai_done_false',
      },
    });
    ctx.counters.escalationsCreated++;
    ctx.escalatedSessions.add(sessionName);
  }

  const tracked = agentStates.get(sessionName);
  if (tracked) {
    tracked.lastState = AgentState.ASKING_QUESTION;
    tracked.lastStateChangeTime = Date.now();
  }
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

function getSessionStaticUnchangedForMs(sessionName: string, nowMs: number): number {
  const tracking = screenStaticBySession.get(sessionName);
  if (!tracking) return 0;
  return Math.max(0, nowMs - tracking.unchangedSinceMs);
}

export const managerCommand = new Command('manager').description(
  'Micromanager daemon that keeps agents productive'
);

// Start the manager daemon
managerCommand
  .command('start')
  .description('Start the manager daemon (runs every 60s)')
  .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
  .option('-v, --verbose', 'Show detailed manager check logs')
  .option('--once', 'Run once and exit')
  .action(async (options: { interval: string; verbose?: boolean; once?: boolean }) => {
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

    const verbose = options.verbose === true;
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
  .option('-v, --verbose', 'Show detailed manager check logs')
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

    await managerCheck(root, config, undefined, options.verbose === true);
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
        hiveConfig: config,
      });

      console.log(chalk.cyan('Running health check...'));
      const result = await scheduler.healthCheck();

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
  clusterRuntime?: ClusterRuntime | null,
  verbose = false
): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(chalk.gray(`[${timestamp}] Manager checking...`));

  await withHiveContext(async ({ paths, db }) => {
    // Load config if not provided (for backwards compatibility)
    if (!config) {
      config = loadConfig(paths.hiveDir);
    }

    if (clusterRuntime?.isEnabled()) {
      verboseLog(verbose, 'Cluster sync: start');
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
        verboseLog(verbose, 'Cluster sync: follower mode skip');
        return;
      }

      const leaderStatus = clusterRuntime.getStatus();
      console.log(
        chalk.gray(`  Cluster leader mode (${leaderStatus.node_id}, term ${leaderStatus.term})`)
      );
      verboseLog(verbose, 'Cluster sync: leader mode ready');
    }

    const ctx: ManagerCheckContext = {
      root,
      verbose,
      config,
      paths,
      db,
      scheduler: new Scheduler(db.db, {
        scaling: config.scaling,
        models: config.models,
        qa: config.qa,
        rootDir: root,
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
        featureTestsSpawned: 0,
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
    verboseLogCtx(ctx, 'Step: sync open PRs from GitHub');
    await syncOpenPRs(ctx);
    verboseLogCtx(ctx, 'Step: close stale PRs');
    await closeStalePRs(ctx);
    verboseLogCtx(ctx, 'Step: sync Jira statuses');
    await syncJiraStatuses(ctx);
    verboseLogCtx(ctx, 'Step: planning handoff recovery');
    await handleStalledPlanningHandoff(ctx);
    verboseLogCtx(ctx, 'Step: restart stale tech lead');
    await restartStaleTechLead(ctx);

    // Discover active tmux sessions
    verboseLogCtx(ctx, 'Step: discover hive tmux sessions');
    const sessions = await getHiveSessions();
    ctx.hiveSessions = sessions.filter(s => s.name.startsWith('hive-'));
    verboseLogCtx(ctx, `Discovered ${ctx.hiveSessions.length} hive session(s)`);
    resolveOrphanedSessionEscalations(ctx);

    verboseLogCtx(ctx, 'Step: prepare session data');
    prepareSessionData(ctx);
    verboseLogCtx(ctx, 'Step: resolve stale escalations');
    resolveStaleEscalations(ctx);

    if (ctx.hiveSessions.length === 0) {
      console.log(chalk.gray('  No agent sessions found'));
      return;
    }

    verboseLogCtx(ctx, 'Step: scan agent sessions');
    await scanAgentSessions(ctx);
    verboseLogCtx(ctx, 'Step: mark forwarded messages as read');
    batchMarkMessagesRead(ctx);
    verboseLogCtx(ctx, 'Step: notify QA about queued PRs');
    await notifyQAOfQueuedPRs(ctx);
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
    await nudgeStuckStories(ctx);
    verboseLogCtx(ctx, 'Step: notify seniors about unassigned stories');
    await notifyUnassignedStories(ctx);
    printSummary(ctx);
  });
}

async function backfillPRNumbers(ctx: ManagerCheckContext): Promise<void> {
  const backfilled = backfillGithubPrNumbers(ctx.db.db);
  verboseLogCtx(ctx, `backfillPRNumbers: backfilled=${backfilled}`);
  if (backfilled > 0) {
    console.log(chalk.yellow(`  Backfilled ${backfilled} PR(s) with github_pr_number from URL`));
  }
}

async function runHealthCheck(ctx: ManagerCheckContext): Promise<void> {
  const healthResult = await ctx.scheduler.healthCheck();
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
      console.log(chalk.yellow(`  Stories returned to queue: ${healthResult.revived.join(', ')}`));
    }
  }

  if (healthResult.orphanedRecovered.length > 0) {
    console.log(
      chalk.green(
        `  Recovered ${healthResult.orphanedRecovered.length} orphaned story(ies): ${healthResult.orphanedRecovered.join(', ')}`
      )
    );
  }

  // If health/orphan recovery returned stories to planned, immediately re-assign
  // so the queue does not stall waiting for a manual `hive assign`.
  if (recoveredStoryIds.length > 0) {
    const assignmentResult = await ctx.scheduler.assignStories();
    verboseLogCtx(
      ctx,
      `runHealthCheck.assignStories: assigned=${assignmentResult.assigned}, errors=${assignmentResult.errors.length}`
    );

    if (assignmentResult.assigned > 0) {
      await ctx.scheduler.flushJiraQueue();
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
  verboseLogCtx(ctx, 'checkMergeQueue: completed');
}

async function runAutoMerge(ctx: ManagerCheckContext): Promise<void> {
  const autoMerged = await autoMergeApprovedPRs(ctx.root, ctx.db);
  verboseLogCtx(ctx, `runAutoMerge: merged=${autoMerged}`);
  if (autoMerged > 0) {
    console.log(chalk.green(`  Auto-merged ${autoMerged} approved PR(s)`));
  }
}

async function syncMergedPRs(ctx: ManagerCheckContext): Promise<void> {
  const mergedSynced = await syncMergedPRsFromGitHub(ctx.root, ctx.db.db);
  verboseLogCtx(ctx, `syncMergedPRs: synced=${mergedSynced}`);
  if (mergedSynced > 0) {
    console.log(chalk.green(`  Synced ${mergedSynced} merged story(ies) from GitHub`));
  }
}

async function syncOpenPRs(ctx: ManagerCheckContext): Promise<void> {
  const maxAgeHours = ctx.config.merge_queue?.max_age_hours;
  const syncedPRs = await syncAllTeamOpenPRs(ctx.root, ctx.db.db, maxAgeHours);
  verboseLogCtx(ctx, `syncOpenPRs: synced=${syncedPRs}`);
  if (syncedPRs > 0) {
    console.log(chalk.yellow(`  Synced ${syncedPRs} GitHub PR(s) into merge queue`));
    await ctx.scheduler.checkMergeQueue();
  }
}

async function closeStalePRs(ctx: ManagerCheckContext): Promise<void> {
  const closedPRs = await closeStaleGitHubPRs(ctx.root, ctx.db.db);
  verboseLogCtx(ctx, `closeStalePRs: closed=${closedPRs.length}`);
  if (closedPRs.length > 0) {
    console.log(chalk.yellow(`  Closed ${closedPRs.length} stale GitHub PR(s):`));
    for (const info of closedPRs) {
      const supersededDesc =
        info.supersededByPrNumber !== null
          ? ` (superseded by PR #${info.supersededByPrNumber})`
          : '';
      console.log(
        chalk.gray(
          `    PR #${info.closedPrNumber} [${info.storyId}] ${info.branch}${supersededDesc}`
        )
      );
    }
  }
}

async function syncJiraStatuses(ctx: ManagerCheckContext): Promise<void> {
  const syncedStories = await syncFromProvider(ctx.root, ctx.db.db);
  verboseLogCtx(ctx, `syncJiraStatuses: synced=${syncedStories}`);
  if (syncedStories > 0) {
    ctx.counters.jiraSynced = syncedStories;
    console.log(chalk.cyan(`  Synced ${syncedStories} story status(es) from Jira`));
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
}

function resolveStaleEscalations(ctx: ManagerCheckContext): void {
  const staleAfterMs = Math.max(
    1,
    ctx.config.manager.nudge_cooldown_ms,
    ctx.config.manager.stuck_threshold_ms
  );
  const pendingEscalations = getPendingEscalations(ctx.db.db);
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
  console.log(chalk.yellow(`  Auto-cleared ${staleEscalations.length} stale escalation(s)`));
}

function resolveOrphanedSessionEscalations(ctx: ManagerCheckContext): void {
  const pendingEscalations = getPendingEscalations(ctx.db.db);
  verboseLogCtx(ctx, `resolveOrphanedSessionEscalations: pending=${pendingEscalations.length}`);
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
    console.log(
      chalk.green(`  AUTO-RESOLVED: ${resolvedCount} stale escalation(s) from inactive sessions`)
    );
  }
  verboseLogCtx(ctx, `resolveOrphanedSessionEscalations: resolved=${resolvedCount}`);
}

async function scanAgentSessions(ctx: ManagerCheckContext): Promise<void> {
  // Batch fetch pending messages and group by recipient
  const allPendingMessages = getAllPendingMessages(ctx.db.db);
  const messagesBySessionName = new Map<string, MessageRow[]>();
  const activeSessionNames = new Set<string>();
  const maxStuckNudgesPerStory = getMaxStuckNudgesPerStory(ctx.config);

  for (const msg of allPendingMessages) {
    if (!messagesBySessionName.has(msg.to_session)) {
      messagesBySessionName.set(msg.to_session, []);
    }
    messagesBySessionName.get(msg.to_session)!.push(msg);
  }

  for (const session of ctx.hiveSessions) {
    if (session.name === 'hive-manager') continue;
    activeSessionNames.add(session.name);

    const agent = ctx.agentsBySessionName.get(session.name);
    const agentCliTool = (agent?.cli_tool || 'claude') as CLITool;
    const safetyMode = getAgentSafetyMode(ctx.config, agent);
    verboseLogCtx(
      ctx,
      `Agent check: ${session.name} (cli=${agentCliTool}, safety=${safetyMode}, story=${agent?.current_story_id || '-'})`
    );

    // Forward unread messages
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
    stateResult = applyHumanInterventionStateOverride(
      ctx,
      session.name,
      agent?.current_story_id || null,
      stateResult
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
        const story = getStoryById(ctx.db.db, storyId);
        if (!story || ['merged', 'completed'].includes(story.status)) {
          verboseLogCtx(
            ctx,
            `Agent ${session.name}: full-ai skipped (story unavailable or closed: ${storyId})`
          );
        } else {
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
              completionAssessment.reason
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
                completionAssessment.reason
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
            await sendToTmuxSession(
              session.name,
              withManagerNudgeEnvelope(
                `# STALLED OUTPUT DETECTED: your terminal output has not changed for ${formatDuration(staticStatus.unchangedForMs)}.
# AI assessment: ${shortReason}
# Stop repeating status updates. Execute the next concrete step now (tests, then PR submit if done).
# If complete, run:
#   hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${storyId} --from ${session.name}
#   hive my-stories complete ${storyId}`
              )
            );
            await sendEnterToTmuxSession(session.name);
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
            createLog(ctx.db.db, {
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

function batchMarkMessagesRead(ctx: ManagerCheckContext): void {
  verboseLogCtx(ctx, `batchMarkMessagesRead: count=${ctx.messagesToMarkRead.length}`);
  if (ctx.messagesToMarkRead.length > 0) {
    markMessagesRead(ctx.db.db, ctx.messagesToMarkRead);
  }
}

async function notifyQAOfQueuedPRs(ctx: ManagerCheckContext): Promise<void> {
  const openPRs = getMergeQueue(ctx.db.db);
  ctx.counters.queuedPRCount = openPRs.length;
  verboseLogCtx(ctx, `notifyQAOfQueuedPRs: open=${openPRs.length}`);

  const queuedPRs = openPRs.filter(pr => pr.status === 'queued');
  verboseLogCtx(ctx, `notifyQAOfQueuedPRs: queued=${queuedPRs.length}`);
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
  verboseLogCtx(ctx, `notifyQAOfQueuedPRs: idleQA=${idleQASessions.length}`);

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
    verboseLogCtx(ctx, `notifyQAOfQueuedPRs: assigned pr=${nextPR.id} -> ${qa.name}`);

    const githubLine = nextPR.github_pr_url ? `\n# GitHub: ${nextPR.github_pr_url}` : '';
    await sendToTmuxSession(
      qa.name,
      withManagerNudgeEnvelope(
        `# You are assigned PR review ${nextPR.id} (${nextPR.story_id || 'no-story'}).${githubLine}
# Execute now:
#   hive pr show ${nextPR.id}
#   hive pr approve ${nextPR.id}
# (If manual merge is required in this repo, use --no-merge.)
# or reject:
#   hive pr reject ${nextPR.id} -r "reason"`
      )
    );
  }

  // Fallback nudge if PRs are still queued but all QA sessions are busy/unavailable.
  if (dispatchCount === 0) {
    verboseLogCtx(ctx, 'notifyQAOfQueuedPRs: no idle QA, sent queue nudge fallback');
    const qaSessions = ctx.hiveSessions.filter(s => s.name.includes('-qa-'));
    for (const qa of qaSessions) {
      await sendToTmuxSession(
        qa.name,
        withManagerNudgeEnvelope(`# ${queuedPRs.length} PR(s) waiting in queue. Run: hive pr queue`)
      );
    }
  }
}

async function handleRejectedPRs(ctx: ManagerCheckContext): Promise<void> {
  const rejectedPRs = getPullRequestsByStatus(ctx.db.db, 'rejected');
  verboseLogCtx(ctx, `handleRejectedPRs: rejected=${rejectedPRs.length}`);
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
        verboseLogCtx(
          ctx,
          `handleRejectedPRs: notifying ${devSession.name} for pr=${pr.id}, story=${pr.story_id || '-'}`
        );
        await sendToTmuxSession(
          devSession.name,
          withManagerNudgeEnvelope(
            `# ⚠️ PR REJECTED - ACTION REQUIRED ⚠️
# Story: ${pr.story_id || 'Unknown'}
# Reason: ${pr.review_notes || 'See review comments'}
#
# You MUST fix this issue before doing anything else.
# Fix the issues and resubmit: hive pr submit -b ${pr.branch_name} -s ${pr.story_id || 'STORY-ID'} --from ${devSession.name}`
          )
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
    console.log(chalk.yellow(`  Notified ${rejectionNotified} developer(s) of PR rejection(s)`));
  }
}

async function nudgeQAFailedStories(ctx: ManagerCheckContext): Promise<void> {
  const qaFailedStories = getStoriesByStatus(ctx.db.db, 'qa_failed').filter(
    story => !['merged', 'completed'].includes(story.status)
  );
  verboseLogCtx(ctx, `nudgeQAFailedStories: candidates=${qaFailedStories.length}`);

  for (const story of qaFailedStories) {
    if (!story.assigned_agent_id) {
      verboseLogCtx(ctx, `nudgeQAFailedStories: story=${story.id} skip=no_assigned_agent`);
      continue;
    }

    const agent = getAgentById(ctx.db.db, story.assigned_agent_id);
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
    const agentCliTool = (agent.cli_tool || 'claude') as CLITool;

    const output = await captureTmuxPane(agentSession.name, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, agentCliTool);

    if (
      stateResult.isWaiting &&
      !stateResult.needsHuman &&
      stateResult.state !== AgentState.THINKING
    ) {
      verboseLogCtx(
        ctx,
        `nudgeQAFailedStories: story=${story.id} nudge session=${agentSession.name} state=${stateResult.state}`
      );
      await sendToTmuxSession(
        agentSession.name,
        withManagerNudgeEnvelope(
          `# REMINDER: Story ${story.id} failed QA review!
# You must fix the issues and resubmit the PR.
# Check the QA feedback and address all concerns.
hive pr queue`
        )
      );
      await sendEnterToTmuxSession(agentSession.name);
    } else {
      verboseLogCtx(
        ctx,
        `nudgeQAFailedStories: story=${story.id} skip=not_ready waiting=${stateResult.isWaiting} needsHuman=${stateResult.needsHuman} state=${stateResult.state}`
      );
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
  verboseLogCtx(ctx, `recoverUnassignedQAFailedStories: recovered=${recoverableStories.length}`);

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

  for (const story of recoverableStories) {
    await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'planned');
  }

  // Proactively re-assign recovered work so it does not stall until manual `hive assign`.
  const assignmentResult = await ctx.scheduler.assignStories();
  verboseLogCtx(
    ctx,
    `recoverUnassignedQAFailedStories.assignStories: assigned=${assignmentResult.assigned}, errors=${assignmentResult.errors.length}`
  );

  if (assignmentResult.assigned > 0) {
    await ctx.scheduler.flushJiraQueue();
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
  const staticInactivityThresholdMs = getScreenStaticInactivityThresholdMs(ctx.config);
  const maxStuckNudgesPerStory = getMaxStuckNudgesPerStory(ctx.config);
  const waitingNudgeCooldownMs = Math.max(
    ctx.config.manager.nudge_cooldown_ms,
    staticInactivityThresholdMs
  );
  const staleUpdatedAt = new Date(Date.now() - stuckThresholdMs).toISOString();
  const stuckStories = queryAll<StoryRow>(
    ctx.db.db,
    `SELECT * FROM stories
     WHERE status = 'in_progress'
     AND updated_at < ?`,
    [staleUpdatedAt]
  ).filter(story => !['merged', 'completed'].includes(story.status));
  verboseLogCtx(
    ctx,
    `nudgeStuckStories: candidates=${stuckStories.length}, staleBefore=${staleUpdatedAt}, thresholdMs=${stuckThresholdMs}`
  );

  for (const story of stuckStories) {
    verboseLogCtx(ctx, `nudgeStuckStories: evaluating story=${story.id}`);
    if (!story.assigned_agent_id) {
      verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=no_assigned_agent`);
      continue;
    }

    const agent = getAgentById(ctx.db.db, story.assigned_agent_id);
    if (!agent) {
      verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=missing_agent`);
      continue;
    }

    const agentSession = findSessionForAgent(ctx.hiveSessions, agent);
    if (!agentSession) {
      verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=no_agent_session`);
      continue;
    }
    const now = Date.now();
    verboseLogCtx(
      ctx,
      `nudgeStuckStories: story=${story.id} session=${agentSession.name} cli=${agent.cli_tool || 'claude'}`
    );

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

    const agentCliTool = (agent.cli_tool || 'claude') as CLITool;
    const output = await captureTmuxPane(agentSession.name, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, agentCliTool);
    verboseLogCtx(
      ctx,
      `nudgeStuckStories: story=${story.id} detected state=${stateResult.state}, waiting=${stateResult.isWaiting}, needsHuman=${stateResult.needsHuman}`
    );
    if (stateResult.needsHuman) {
      verboseLogCtx(ctx, `nudgeStuckStories: story=${story.id} skip=needs_human`);
      continue;
    }
    if (!stateResult.isWaiting || stateResult.state === AgentState.THINKING) {
      if (trackedState && (trackedState.storyStuckNudgeCount || 0) > 0) {
        trackedState.storyStuckNudgeCount = 0;
      }
      clearHumanIntervention(agentSession.name);
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=not_waiting_or_thinking state=${stateResult.state}`
      );
      continue;
    }

    const sessionUnchangedForMs = getSessionStaticUnchangedForMs(agentSession.name, now);
    if (sessionUnchangedForMs < staticInactivityThresholdMs) {
      verboseLogCtx(
        ctx,
        `nudgeStuckStories: story=${story.id} skip=done_inference_static_window remainingMs=${staticInactivityThresholdMs - sessionUnchangedForMs}`
      );
    } else {
      const completionAssessment = await assessCompletionFromOutput(
        ctx.config,
        agentSession.name,
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
          agentSession.name,
          story.id,
          completionAssessment.reason
        );
        verboseLogCtx(
          ctx,
          `nudgeStuckStories: story=${story.id} action=classifier_timeout_escalation session=${agentSession.name}`
        );
        continue;
      }
      clearHumanIntervention(agentSession.name);

      if (aiSaysDone) {
        const progressed = await autoProgressDoneStory(
          ctx,
          story,
          agent,
          agentSession.name,
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
            agentSession.name,
            story.id,
            completionAssessment.reason
          );
          verboseLogCtx(
            ctx,
            `nudgeStuckStories: story=${story.id} action=done_false_escalation session=${agentSession.name}`
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
        `nudgeStuckStories: story=${story.id} action=mandatory_completion_signal session=${agentSession.name}`
      );
      await sendToTmuxSession(
        agentSession.name,
        withManagerNudgeEnvelope(
          `# MANDATORY COMPLETION SIGNAL: execute now for ${story.id}
hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${story.id} --from ${agentSession.name}
hive my-stories complete ${story.id}
hive progress ${story.id} -m "PR submitted to merge queue" --from ${agentSession.name} --done
# Do not stop at a summary. Completion requires the commands above.`
        )
      );
      await sendEnterToTmuxSession(agentSession.name);
      ctx.counters.nudged++;
      if (trackedState) {
        trackedState.lastNudgeTime = now;
        trackedState.storyStuckNudgeCount = (trackedState.storyStuckNudgeCount || 0) + 1;
      } else {
        agentStates.set(agentSession.name, {
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
      `nudgeStuckStories: story=${story.id} action=stuck_reminder session=${agentSession.name}`
    );
    await sendToTmuxSession(
      agentSession.name,
      withManagerNudgeEnvelope(
        `# REMINDER: Story ${story.id} has been in progress for a while.
# If stuck, escalate to your Senior or Tech Lead.
# If done, submit your PR: hive pr submit -b $(git rev-parse --abbrev-ref HEAD) -s ${story.id} --from ${agentSession.name}
# Then mark complete: hive my-stories complete ${story.id}`
      )
    );
    await sendEnterToTmuxSession(agentSession.name);
    ctx.counters.nudged++;
    if (trackedState) {
      trackedState.lastNudgeTime = now;
      trackedState.storyStuckNudgeCount = (trackedState.storyStuckNudgeCount || 0) + 1;
    } else {
      agentStates.set(agentSession.name, {
        lastState: stateResult.state,
        lastStateChangeTime: now,
        lastNudgeTime: now,
        storyStuckNudgeCount: 1,
      });
    }
  }
}

async function autoProgressDoneStory(
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
  const openPRs = getOpenPullRequestsByStory(ctx.db.db, story.id);
  verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id}, openPRs=${openPRs.length}`);
  if (openPRs.length > 0) {
    if (story.status !== 'pr_submitted') {
      updateStory(ctx.db.db, story.id, { status: 'pr_submitted' });
      createLog(ctx.db.db, {
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
      await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'pr_submitted');
      verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id} status moved to pr_submitted`);
    }
    await sendToTmuxSession(
      sessionName,
      withManagerNudgeEnvelope(
        `# AUTO-PROGRESS: Manager inferred ${story.id} is complete (confidence ${confidence.toFixed(2)}), detected existing PR, and moved story to PR-submitted state.`
      )
    );
    await sendEnterToTmuxSession(sessionName);
    verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id} action=existing_pr_progressed`);
    return true;
  }

  const branch = await resolveStoryBranchName(ctx.root, story, agent, msg =>
    verboseLogCtx(ctx, `resolveStoryBranchName: story=${story.id} ${msg}`)
  );
  if (!branch) {
    verboseLogCtx(ctx, `autoProgressDoneStory: story=${story.id} action=failed_no_branch`);
    return false;
  }

  await withTransaction(ctx.db.db, () => {
    updateStory(ctx.db.db, story.id, { status: 'pr_submitted', branchName: branch });
    createPullRequest(ctx.db.db, {
      storyId: story.id,
      teamId: story.team_id || null,
      branchName: branch,
      submittedBy: sessionName,
    });
    createLog(ctx.db.db, {
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
  });
  await syncStatusForStory(ctx.root, ctx.db.db, story.id, 'pr_submitted');
  await ctx.scheduler.checkMergeQueue();
  verboseLogCtx(
    ctx,
    `autoProgressDoneStory: story=${story.id} action=auto_submitted branch=${branch}`
  );

  await sendToTmuxSession(
    sessionName,
    withManagerNudgeEnvelope(
      `# AUTO-PROGRESS: Manager inferred ${story.id} is complete (confidence ${confidence.toFixed(2)}), auto-submitted branch ${branch} to merge queue.`
    )
  );
  await sendEnterToTmuxSession(sessionName);
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

async function notifyUnassignedStories(ctx: ManagerCheckContext): Promise<void> {
  const plannedStories = queryAll<StoryRow>(
    ctx.db.db,
    "SELECT * FROM stories WHERE status = 'planned' AND assigned_agent_id IS NULL"
  );

  if (plannedStories.length === 0) return;
  verboseLogCtx(ctx, `notifyUnassignedStories: plannedUnassigned=${plannedStories.length}`);

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
      await sendToTmuxSession(
        senior.name,
        withManagerNudgeEnvelope(
          `# ${plannedStories.length} unassigned story(ies). Run: hive my-stories ${senior.name} --all`
        )
      );
    } else {
      verboseLogCtx(
        ctx,
        `notifyUnassignedStories: skip ${senior.name} waiting=${stateResult.isWaiting} needsHuman=${stateResult.needsHuman} state=${stateResult.state}`
      );
    }
  }
}

async function restartStaleTechLead(ctx: ManagerCheckContext): Promise<void> {
  const maxAgeHours = ctx.config.manager.tech_lead_max_age_hours;
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();

  // Get all tech lead agents
  const techLeads = getAgentsByType(ctx.db.db, 'tech_lead');
  verboseLogCtx(ctx, `restartStaleTechLead: found ${techLeads.length} tech lead agent(s)`);

  for (const techLead of techLeads) {
    // Check if tech lead has a tmux session
    if (!techLead.tmux_session) {
      verboseLogCtx(ctx, `restartStaleTechLead: techLead=${techLead.id} skip=no_tmux_session`);
      continue;
    }

    // Check if session is running
    const sessionRunning = await isTmuxSessionRunning(techLead.tmux_session);
    if (!sessionRunning) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=session_not_running session=${techLead.tmux_session}`
      );
      continue;
    }

    // Calculate session age
    const createdAt = new Date(techLead.created_at).getTime();
    const ageMs = now - createdAt;
    const ageHours = ageMs / (60 * 60 * 1000);

    verboseLogCtx(
      ctx,
      `restartStaleTechLead: techLead=${techLead.id} age=${ageHours.toFixed(2)}h threshold=${maxAgeHours}h`
    );

    // Check if session has exceeded max age
    if (ageMs < maxAgeMs) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=not_stale remainingMs=${maxAgeMs - ageMs}`
      );
      continue;
    }

    // Check tech lead state
    const agentCliTool = (techLead.cli_tool || 'claude') as CLITool;
    const output = await captureTmuxPane(techLead.tmux_session, TMUX_CAPTURE_LINES_SHORT);
    const stateResult = detectAgentState(output, agentCliTool);

    verboseLogCtx(
      ctx,
      `restartStaleTechLead: techLead=${techLead.id} state=${stateResult.state} waiting=${stateResult.isWaiting} needsHuman=${stateResult.needsHuman}`
    );

    // Only restart if tech lead is in a safe state (waiting/idle, not mid-task)
    if (
      !stateResult.isWaiting ||
      stateResult.needsHuman ||
      stateResult.state === AgentState.THINKING
    ) {
      verboseLogCtx(
        ctx,
        `restartStaleTechLead: techLead=${techLead.id} skip=not_safe_state state=${stateResult.state}`
      );
      continue;
    }

    // Perform graceful restart
    verboseLogCtx(
      ctx,
      `restartStaleTechLead: techLead=${techLead.id} action=restarting session=${techLead.tmux_session}`
    );

    // Log the restart
    createLog(ctx.db.db, {
      agentId: 'manager',
      eventType: 'AGENT_SPAWNED',
      status: 'info',
      message: `Tech lead ${techLead.id} restarted for context freshness (age: ${ageHours.toFixed(1)}h)`,
      metadata: {
        agent_id: techLead.id,
        tmux_session: techLead.tmux_session,
        age_hours: ageHours,
        threshold_hours: maxAgeHours,
        restart_reason: 'context_freshness',
      },
    });

    // Kill the existing session
    await killTmuxSession(techLead.tmux_session);

    // Spawn a new session with the same configuration
    const hiveRoot = findHiveRootFromDir(ctx.root);
    if (!hiveRoot) {
      verboseLogCtx(ctx, `restartStaleTechLead: techLead=${techLead.id} error=hive_root_not_found`);
      continue;
    }

    const paths = getHivePaths(hiveRoot);
    const config = loadConfig(paths.hiveDir);
    const agentConfig = config.models.tech_lead;
    const cliTool = agentConfig.cli_tool;
    const safetyMode = agentConfig.safety_mode;
    const model = resolveRuntimeModelForCli(agentConfig.model, cliTool);

    const runtimeBuilder = getCliRuntimeBuilder(cliTool);
    const commandArgs = runtimeBuilder.buildSpawnCommand(model, safetyMode);

    await spawnTmuxSession({
      sessionName: techLead.tmux_session,
      workDir: ctx.root,
      commandArgs,
    });

    // Update agent record status (updated_at is set automatically)
    updateAgent(ctx.db.db, techLead.id, {
      status: 'working',
    });

    console.log(
      chalk.green(
        `  Tech lead ${techLead.id} restarted for context freshness (age: ${ageHours.toFixed(1)}h)`
      )
    );
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
    featureTestsSpawned,
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
  if (featureTestsSpawned > 0) summary.push(`${featureTestsSpawned} feature test(s) spawned`);

  if (summary.length > 0) {
    console.log(chalk.yellow(`  ${summary.join(', ')}`));
  } else {
    console.log(chalk.green('  All agents productive'));
  }
}

// autoMergeApprovedPRs moved to src/utils/auto-merge.ts for reuse in pr.ts
