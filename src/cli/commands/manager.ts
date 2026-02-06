import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase, withTransaction } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import type { HiveConfig } from '../../config/schema.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { getHiveSessions, sendToTmuxSession, sendEnterToTmuxSession, captureTmuxPane, isManagerRunning, stopManager as stopManagerSession, killTmuxSession } from '../../tmux/manager.js';
import { getMergeQueue, getPullRequestsByStatus, backfillGithubPrNumbers } from '../../db/queries/pull-requests.js';
import { markMessagesRead, getAllPendingMessages, type MessageRow } from '../../db/queries/messages.js';
import { createEscalation, getPendingEscalations } from '../../db/queries/escalations.js';
import { getAgentById, updateAgent, getAllAgents } from '../../db/queries/agents.js';
import { createLog } from '../../db/queries/logs.js';
import { queryAll } from '../../db/client.js';
import type { StoryRow } from '../../db/client.js';
import { getAllTeams } from '../../db/queries/teams.js';
import { updateStory, getStoriesByStatus } from '../../db/queries/stories.js';
import { execa } from 'execa';
import { createPullRequest, type PullRequestRow } from '../../db/queries/pull-requests.js';
import { acquireLock } from '../../db/lock.js';
import { join } from 'path';
import { detectClaudeCodeState, getStateDescription, ClaudeCodeState } from '../../utils/claude-code-state.js';
import { getAvailableCommands, buildAutoRecoveryReminder, type CLITool } from '../../utils/cli-commands.js';
import { autoMergeApprovedPRs } from '../../utils/auto-merge.js';

// Agent state tracking for nudge logic
interface AgentStateTracking {
  lastState: ClaudeCodeState;
  lastStateChangeTime: number;
  lastNudgeTime: number;
}

// In-memory state tracking per agent session
const agentStates = new Map<string, AgentStateTracking>();

export const managerCommand = new Command('manager')
  .description('Micromanager daemon that keeps agents productive');

// Start the manager daemon
managerCommand
  .command('start')
  .description('Start the manager daemon (runs every 60s)')
  .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
  .option('--once', 'Run once and exit')
  .action(async (options: { interval: string; once?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);

    // Load config first to get all settings
    const config = loadConfig(paths.hiveDir);

    const lockPath = join(paths.hiveDir, 'manager.lock');

    // Acquire manager lock to ensure singleton
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      releaseLock = await acquireLock(lockPath, { stale: config.manager.lock_stale_ms });
      console.log(chalk.gray('Manager lock acquired'));
    } catch (err) {
      console.error(chalk.red('Failed to acquire manager lock - another manager instance may be running.'), err);
      console.error(chalk.gray('If you are sure no other manager is running, remove:'), lockPath + '.lock');
      process.exit(1);
    }

    // Release lock on exit
    const cleanup = async () => {
      if (releaseLock) {
        await releaseLock();
        console.log(chalk.gray('\nManager lock released'));
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Support two modes: legacy single-interval and new two-tier polling
    const useTwoTier = options.interval === '60' && config.manager;

    if (useTwoTier) {
      // Two-tier polling - use slow interval (60s) by default to reduce interruptions
      const slowInterval = config.manager.slow_poll_interval;
      console.log(chalk.cyan(`Manager started (polling every ${slowInterval / 1000}s)`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      const runCheck = async () => {
        try {
          await managerCheck(root, config);
        } catch (err) {
          console.error(chalk.red('Manager error:'), err);
        }
      };

      await runCheck();

      if (!options.once) {
        setInterval(runCheck, slowInterval);
      } else if (releaseLock) {
        await releaseLock();
      }
    } else {
      // Legacy mode: single interval
      const interval = parseInt(options.interval, 10) * 1000;
      console.log(chalk.cyan(`Manager started (checking every ${options.interval}s)`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      const runCheck = async () => {
        try {
          await managerCheck(root, config);
        } catch (err) {
          console.error(chalk.red('Manager error:'), err);
        }
      };

      await runCheck();

      if (!options.once) {
        setInterval(runCheck, interval);
      } else if (releaseLock) {
        await releaseLock();
      }
    }
  });

// Run a single check
managerCommand
  .command('check')
  .description('Run a single manager check')
  .action(async () => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    await managerCheck(root, config);
  });

// Run health check to sync agents with tmux
managerCommand
  .command('health')
  .description('Sync agent status with actual tmux sessions')
  .action(async () => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const config = loadConfig(paths.hiveDir);
      const scheduler = new Scheduler(db.db, {
        scaling: config.scaling,
        models: config.models,
        qa: config.qa,
        rootDir: root,
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
    } finally {
      db.close();
    }
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
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
      const agent = getAgentById(db.db, session.replace('hive-', ''));
      const cliTool = (agent?.cli_tool || 'claude') as CLITool;
      await nudgeAgent(root, session, options.message, undefined, undefined, cliTool);
      console.log(chalk.green(`Nudged ${session}`));
    } finally {
      db.close();
    }
  });

async function managerCheck(root: string, config?: HiveConfig): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(chalk.gray(`[${timestamp}] Manager checking...`));

  const paths = getHivePaths(root);
  const db = await getDatabase(paths.hiveDir);

  try {
    // Load config if not provided (for backwards compatibility)
    if (!config) {
      config = loadConfig(paths.hiveDir);
    }

    // Backfill github_pr_number for existing PRs on first run (idempotent)
    const backfilled = backfillGithubPrNumbers(db.db);
    if (backfilled > 0) {
      console.log(chalk.yellow(`  Backfilled ${backfilled} PR(s) with github_pr_number from URL`));
      db.save();
    }

    // First, run health check to sync agent status with tmux
    const scheduler = new Scheduler(db.db, {
      scaling: config.scaling,
      models: config.models,
      qa: config.qa,
      rootDir: root,
    });

    const healthResult = await scheduler.healthCheck();
    if (healthResult.terminated > 0) {
      console.log(chalk.yellow(`  Health check: ${healthResult.terminated} dead agent(s) cleaned up`));
      if (healthResult.revived.length > 0) {
        console.log(chalk.yellow(`  Stories returned to queue: ${healthResult.revived.join(', ')}`));
      }
      db.save();
    }

    // Check merge queue for QA spawning
    await scheduler.checkMergeQueue();
    db.save();

    // Auto-merge approved PRs
    const autoMerged = await autoMergeApprovedPRs(root, db);
    if (autoMerged > 0) {
      console.log(chalk.green(`  Auto-merged ${autoMerged} approved PR(s)`));
      db.save();
    }

    // Sync merged PRs from GitHub to keep story statuses in sync
    const mergedSynced = await syncMergedPRsFromGitHub(root, db);
    if (mergedSynced > 0) {
      console.log(chalk.green(`  Synced ${mergedSynced} merged story(ies) from GitHub`));
    }

    // Sync GitHub PRs that might not be in queue
    const syncedPRs = await syncGitHubPRs(root, db, paths.hiveDir);
    if (syncedPRs > 0) {
      console.log(chalk.yellow(`  Synced ${syncedPRs} GitHub PR(s) into merge queue`));
      // Recheck merge queue after syncing
      await scheduler.checkMergeQueue();
      db.save();
    }

    const sessions = await getHiveSessions();
    const hiveSessions = sessions.filter(s =>
      s.name.startsWith('hive-')
    );

    if (hiveSessions.length === 0) {
      console.log(chalk.gray('  No agent sessions found'));
      return;
    }

    let nudged = 0;
    let messagesForwarded = 0;
    let escalationsCreated = 0;

    // Get existing pending escalations to avoid duplicates
    const existingEscalations = getPendingEscalations(db.db);
    const escalatedSessions = new Set(
      existingEscalations
        .filter(e => e.from_agent_id)
        .map(e => e.from_agent_id)
    );

    // Optimization: Batch fetch all agents and messages instead of per-session queries
    const allAgents = getAllAgents(db.db);
    const agentsBySessionName = new Map(
      allAgents.map(a => [`hive-${a.id}`, a])
    );

    const allPendingMessages = getAllPendingMessages(db.db);
    const messagesBySessionName = new Map<string, MessageRow[]>();
    const messagesToMarkRead: string[] = [];

    for (const msg of allPendingMessages) {
      if (!messagesBySessionName.has(msg.to_session)) {
        messagesBySessionName.set(msg.to_session, []);
      }
      messagesBySessionName.get(msg.to_session)!.push(msg);
    }

    for (const session of hiveSessions) {
      // Skip manager itself
      if (session.name === 'hive-manager') continue;

      // Get agent information for CLI-aware messaging (from cached data)
      const agent = agentsBySessionName.get(session.name);
      const agentCliTool = (agent?.cli_tool || 'claude') as CLITool;

      // Check if agent has unread messages (from cached data)
      const unread = messagesBySessionName.get(session.name) || [];
      if (unread.length > 0) {
        await forwardMessages(session.name, unread, agentCliTool);
        messagesForwarded += unread.length;
        // Collect message IDs to mark as read in batch
        messagesToMarkRead.push(...unread.map(msg => msg.id));
      }

      // Check if agent appears stuck (capture last output)
      const output = await captureTmuxPane(session.name, 50);
      const stateResult = detectClaudeCodeState(output);

      // Track state changes for this agent
      const now = Date.now();
      const trackedState = agentStates.get(session.name);

      if (!trackedState) {
        // First time seeing this agent - initialize tracking
        agentStates.set(session.name, {
          lastState: stateResult.state,
          lastStateChangeTime: now,
          lastNudgeTime: 0,
        });
      } else if (trackedState.lastState !== stateResult.state) {
        // State changed - update tracking
        trackedState.lastState = stateResult.state;
        trackedState.lastStateChangeTime = now;
      }

      // Convert to legacy format for escalation logic
      const waitingInfo = {
        isWaiting: stateResult.isWaiting,
        needsHuman: stateResult.needsHuman,
        reason: stateResult.needsHuman ? getStateDescription(stateResult.state) : undefined,
      };

      if (waitingInfo.needsHuman && !escalatedSessions.has(session.name)) {
        // Create escalation for human attention
        const storyId = agent?.current_story_id || null;

        createEscalation(db.db, {
          storyId,
          fromAgentId: session.name,
          toAgentId: null, // Escalate to human
          reason: `Agent waiting for input: ${waitingInfo.reason || 'Unknown question'}`,
        });
        db.save();
        escalationsCreated++;
        escalatedSessions.add(session.name);

        // Also remind the agent to continue autonomously if they can
        const reminder = buildAutoRecoveryReminder(session.name, agentCliTool);
        await sendToTmuxSession(session.name, reminder);

        console.log(chalk.red(`  ESCALATION: ${session.name} needs human input`));
      } else if (waitingInfo.isWaiting && stateResult.state !== ClaudeCodeState.THINKING) {
        // Agent is idle/waiting but doesn't need human
        // Check if we should nudge based on state duration and cooldown
        const currentTrackedState = agentStates.get(session.name);
        if (currentTrackedState) {
          const timeSinceStateChange = now - currentTrackedState.lastStateChangeTime;
          const timeSinceLastNudge = now - currentTrackedState.lastNudgeTime;

          // Only nudge if:
          // 1. Agent stuck in same state for configured threshold
          // 2. Haven't nudged within cooldown period
          // 3. Not in THINKING state (extended thinking is normal)
          if (
            timeSinceStateChange > config.manager.stuck_threshold_ms &&
            timeSinceLastNudge > config.manager.nudge_cooldown_ms
          ) {
            // Re-check state immediately before nudging to avoid interrupting active work
            const recheckOutput = await captureTmuxPane(session.name, 50);
            const recheckState = detectClaudeCodeState(recheckOutput);

            // Only proceed if still in a waiting state and not THINKING
            if (recheckState.isWaiting && !recheckState.needsHuman && recheckState.state !== ClaudeCodeState.THINKING) {
              const agentType = getAgentType(session.name);
              await nudgeAgent(root, session.name, undefined, agentType, waitingInfo.reason, agentCliTool);
              currentTrackedState.lastNudgeTime = now;
              nudged++;
            }
          }
        }
      }
      // If not waiting (actively working), do nothing - let them work
    }

    // Batch mark all messages as read after processing
    if (messagesToMarkRead.length > 0) {
      markMessagesRead(db.db, messagesToMarkRead);
      db.save();
    }

    // Check for PRs needing QA attention
    const queuedPRs = getMergeQueue(db.db);
    if (queuedPRs.length > 0) {
      const qaSessions = hiveSessions.filter(s => s.name.includes('-qa-'));
      for (const qa of qaSessions) {
        await sendToTmuxSession(qa.name,
          `# ${queuedPRs.length} PR(s) waiting in queue. Run: hive pr queue`
        );
      }
    }

    // Check for rejected PRs that need developer attention
    // Only notify once by updating status to 'closed' after notification (prevents spam)
    const rejectedPRs = getPullRequestsByStatus(db.db, 'rejected');
    let rejectionNotified = 0;
    for (const pr of rejectedPRs) {
      // Update the story status to qa_failed so developer knows they need to act
      if (pr.story_id) {
        const storyId = pr.story_id;
        await withTransaction(db.db, () => {
          updateStory(db.db, storyId, { status: 'qa_failed' });
          createLog(db.db, {
            agentId: 'manager',
            eventType: 'STORY_QA_FAILED',
            message: `Story ${storyId} QA failed: ${pr.review_notes || 'See review comments'}`,
            storyId: storyId,
          });
        });
      }

      if (pr.submitted_by) {
        const devSession = hiveSessions.find(s => s.name === pr.submitted_by);
        if (devSession) {
          await sendToTmuxSession(devSession.name,
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
      db.db.run("UPDATE pull_requests SET status = 'closed' WHERE id = ?", [pr.id]);
    }
    if (rejectedPRs.length > 0) {
      db.save();
      console.log(chalk.yellow(`  Notified ${rejectionNotified} developer(s) of PR rejection(s)`));
    }

    // Nudge developers who have qa_failed stories - they need to fix and resubmit
    // Filter out merged/completed stories to avoid nudging about finished work
    const qaFailedStories = getStoriesByStatus(db.db, 'qa_failed').filter(
      story => !['merged', 'completed'].includes(story.status)
    );
    for (const story of qaFailedStories) {
      if (story.assigned_agent_id) {
        const agent = getAgentById(db.db, story.assigned_agent_id);
        if (agent && agent.status === 'working') {
          const agentSession = hiveSessions.find(s =>
            s.name === agent.tmux_session || s.name.includes(agent.id)
          );
          if (agentSession) {
            // Check if agent is idle before nudging
            const output = await captureTmuxPane(agentSession.name, 30);
            const stateResult = detectClaudeCodeState(output);
            // Only nudge if idle and not thinking (thinking is productive work)
            if (stateResult.isWaiting && !stateResult.needsHuman && stateResult.state !== ClaudeCodeState.THINKING) {
              await sendToTmuxSession(agentSession.name,
                `# REMINDER: Story ${story.id} failed QA review!
# You must fix the issues and resubmit the PR.
# Check the QA feedback and address all concerns.
hive pr queue`
              );
              await sendEnterToTmuxSession(agentSession.name);
            }
          }
        }
      }
    }

    // Spin down agents whose stories have been merged
    // Find merged stories that still have assigned agents
    const mergedStoriesWithAgents = queryAll<StoryRow>(db.db,
      `SELECT * FROM stories WHERE status = 'merged' AND assigned_agent_id IS NOT NULL`
    );
    let agentsSpunDown = 0;
    for (const story of mergedStoriesWithAgents) {
      if (story.assigned_agent_id) {
        const agent = getAgentById(db.db, story.assigned_agent_id);
        if (agent && agent.status !== 'terminated') {
          // Find and kill the agent's tmux session
          const agentSession = hiveSessions.find(s =>
            s.name === agent.tmux_session || s.name.includes(agent.id)
          );

          if (agentSession) {
            // Thank the agent and terminate
            await sendToTmuxSession(agentSession.name,
              `# Congratulations! Your story ${story.id} has been merged.
# Your work is complete. Spinning down...`
            );
            await new Promise(resolve => setTimeout(resolve, 1000));
            await killTmuxSession(agentSession.name);
          }

          // Mark agent as terminated, log termination, and clear story assignment (atomic transaction)
          await withTransaction(db.db, () => {
            updateAgent(db.db, agent.id, { status: 'terminated', currentStoryId: null });

            createLog(db.db, {
              agentId: agent.id,
              storyId: story.id,
              eventType: 'AGENT_TERMINATED',
              message: `Agent spun down after story ${story.id} was merged`,
            });

            db.db.run("UPDATE stories SET assigned_agent_id = NULL WHERE id = ?", [story.id]);
          });

          agentsSpunDown++;
        }
      }
    }
    if (agentsSpunDown > 0) {
      db.save();
      console.log(chalk.green(`  Spun down ${agentsSpunDown} agent(s) after successful merge`));
    }

    // Spin down all non-tech-lead agents when no work remains in the pipeline
    const activeStories = queryAll<StoryRow>(db.db,
      `SELECT * FROM stories WHERE status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')`
    );
    if (activeStories.length === 0) {
      // No active work - spin down all agents except tech lead
      const workingAgents = queryAll<{ id: string; tmux_session: string | null; type: string }>(db.db,
        `SELECT id, tmux_session, type FROM agents WHERE status = 'working' AND type != 'tech_lead'`
      );
      let idleSpunDown = 0;
      for (const agent of workingAgents) {
        const agentSession = hiveSessions.find(s => s.name === agent.tmux_session);
        if (agentSession) {
          await sendToTmuxSession(agentSession.name,
            `# All work complete. No stories in pipeline. Spinning down...`
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          await killTmuxSession(agentSession.name);
        }
        // Update agent and log spindown (atomic transaction)
        await withTransaction(db.db, () => {
          updateAgent(db.db, agent.id, { status: 'terminated', currentStoryId: null });
          createLog(db.db, {
            agentId: agent.id,
            eventType: 'AGENT_TERMINATED',
            message: 'Agent spun down - no work remaining in pipeline',
          });
        });
        idleSpunDown++;
      }
      if (idleSpunDown > 0) {
        db.save();
        console.log(chalk.green(`  Spun down ${idleSpunDown} idle agent(s) - pipeline empty`));
      }
    }

    // Check for stories stuck in "in_progress" for too long (> 30 min without activity)
    // Only nudge stories that haven't been merged or completed
    const stuckStories = queryAll<StoryRow>(db.db,
      `SELECT * FROM stories
       WHERE status = 'in_progress'
       AND updated_at < datetime('now', '-30 minutes')`
    ).filter(story => !['merged', 'completed'].includes(story.status));
    for (const story of stuckStories) {
      if (story.assigned_agent_id) {
        const agentSession = hiveSessions.find(s =>
          s.name.includes(story.assigned_agent_id?.replace(/^hive-/, '') || '')
        );
        if (agentSession) {
          await sendToTmuxSession(agentSession.name,
            `# REMINDER: Story ${story.id} has been in progress for a while.
# If stuck, escalate to your Senior or Tech Lead.
# If done, submit your PR: hive pr submit -b <branch> -s ${story.id} --from ${agentSession.name}
# Then mark complete: hive my-stories complete ${story.id}`
          );
        }
      }
    }

    // Check for unassigned planned stories
    const plannedStories = queryAll<StoryRow>(db.db,
      "SELECT * FROM stories WHERE status = 'planned' AND assigned_agent_id IS NULL"
    );
    if (plannedStories.length > 0) {
      // Notify seniors about unassigned work
      const seniorSessions = hiveSessions.filter(s => s.name.includes('-senior-'));
      for (const senior of seniorSessions) {
        await sendToTmuxSession(senior.name,
          `# ${plannedStories.length} unassigned story(ies). Run: hive my-stories ${senior.name} --all`
        );
      }
    }

    // Summary
    const summary = [];
    if (escalationsCreated > 0) summary.push(`${escalationsCreated} escalations created`);
    if (nudged > 0) summary.push(`${nudged} nudged`);
    if (messagesForwarded > 0) summary.push(`${messagesForwarded} messages forwarded`);
    if (queuedPRs.length > 0) summary.push(`${queuedPRs.length} PRs queued`);

    if (summary.length > 0) {
      console.log(chalk.yellow(`  ${summary.join(', ')}`));
    } else {
      console.log(chalk.green('  All agents productive'));
    }

  } finally {
    db.close();
  }
}


function getAgentType(sessionName: string): 'senior' | 'intermediate' | 'junior' | 'qa' | 'unknown' {
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
  const cliTool = agentCliTool || 'claude' as CLITool;
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
  await new Promise(resolve => setTimeout(resolve, 100));
  await sendEnterToTmuxSession(sessionName);
}

async function forwardMessages(sessionName: string, messages: MessageRow[], cliTool: CLITool = 'claude'): Promise<void> {
  const commands = getAvailableCommands(cliTool);
  for (const msg of messages) {
    const notification = `# New message from ${msg.from_session}${msg.subject ? ` - ${msg.subject}` : ''}
# ${msg.body}
# Reply with: # ${commands.msgReply(msg.id, 'your response', sessionName)}`;

    await sendToTmuxSession(sessionName, notification);
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

interface DatabaseClient {
  db: import('sql.js').Database;
  save: () => void;
}

async function syncMergedPRsFromGitHub(root: string, db: DatabaseClient): Promise<number> {
  const teams = getAllTeams(db.db);
  if (teams.length === 0) return 0;

  let storiesUpdated = 0;

  for (const team of teams) {
    if (!team.repo_path) continue;

    const repoDir = `${root}/${team.repo_path}`;

    try {
      // Get recently merged PRs from GitHub
      const result = await execa('gh', ['pr', 'list', '--json', 'number,headRefName,mergedAt', '--state', 'merged', '--limit', '20'], {
        cwd: repoDir,
      });
      const mergedPRs: Array<{ number: number; headRefName: string; mergedAt: string }> = JSON.parse(result.stdout);

      for (const pr of mergedPRs) {
        // Extract story ID from branch name - match STORY-XXX-NAME pattern
        // Use a more specific pattern to avoid matching extra suffixes
        const storyMatch = pr.headRefName.match(/STORY-\d+-[A-Z]+/i);
        if (!storyMatch) continue;

        const storyId = storyMatch[0].toUpperCase();

        // Check if story exists and isn't already merged
        const story = queryAll<StoryRow>(db.db,
          "SELECT * FROM stories WHERE id = ? AND status != 'merged'",
          [storyId]
        );

        if (story.length > 0) {
          // Update story to merged
          db.db.run("UPDATE stories SET status = 'merged', assigned_agent_id = NULL, updated_at = datetime('now') WHERE id = ?", [storyId]);

          // Log the sync
          createLog(db.db, {
            agentId: 'manager',
            storyId: storyId,
            eventType: 'STORY_MERGED',
            message: `Story synced to merged from GitHub PR #${pr.number}`,
          });

          storiesUpdated++;
        }
      }
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
      continue;
    }
  }

  if (storiesUpdated > 0) {
    db.save();
  }

  return storiesUpdated;
}

async function syncGitHubPRs(root: string, db: DatabaseClient, _hiveDir: string): Promise<number> {
  const teams = getAllTeams(db.db);
  if (teams.length === 0) return 0;

  // Get ALL existing PRs (including merged/closed) to prevent duplicate imports
  const existingPRs = queryAll<PullRequestRow>(db.db,
    "SELECT * FROM pull_requests"
  );
  // Include ALL branch names to prevent duplicate entries for merged/closed PRs
  const existingBranches = new Set(existingPRs.map(pr => pr.branch_name));
  const existingPrNumbers = new Set(existingPRs.map(pr => pr.github_pr_number).filter(Boolean));

  let synced = 0;

  for (const team of teams) {
    if (!team.repo_path) continue;

    const repoDir = `${root}/${team.repo_path}`;

    try {
      const result = await execa('gh', ['pr', 'list', '--json', 'number,headRefName,url,title', '--state', 'open'], {
        cwd: repoDir,
      });
      const ghPRs: Array<{ number: number; headRefName: string; url: string; title: string }> = JSON.parse(result.stdout);

      for (const ghPR of ghPRs) {
        // Skip if already in queue
        if (existingBranches.has(ghPR.headRefName) || existingPrNumbers.has(ghPR.number)) {
          continue;
        }

        // Try to match to a story by parsing branch name
        const storyMatch = ghPR.headRefName.match(/STORY-\d+/i);
        const storyId = storyMatch ? storyMatch[0].toUpperCase() : null;

        createPullRequest(db.db, {
          storyId,
          teamId: team.id,
          branchName: ghPR.headRefName,
          githubPrNumber: ghPR.number,
          githubPrUrl: ghPR.url,
          submittedBy: null,
        });

        synced++;
      }
    } catch {
      // gh CLI might not be authenticated or repo might not have remote
      continue;
    }
  }

  if (synced > 0) {
    db.save();
  }

  return synced;
}

// autoMergeApprovedPRs moved to src/utils/auto-merge.ts for reuse in pr.ts
