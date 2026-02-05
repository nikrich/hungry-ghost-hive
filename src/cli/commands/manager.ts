import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { getHiveSessions, sendToTmuxSession, sendEnterToTmuxSession, captureTmuxPane, isManagerRunning, stopManager as stopManagerSession } from '../../tmux/manager.js';
import { getMergeQueue, getPullRequestsByStatus } from '../../db/queries/pull-requests.js';
import { getUnreadMessages, markMessageRead, type MessageRow } from '../../db/queries/messages.js';
import { createEscalation, getPendingEscalations } from '../../db/queries/escalations.js';
import { getAgentById } from '../../db/queries/agents.js';
import { queryAll } from '../../db/client.js';
import type { StoryRow } from '../../db/client.js';
import { getAllTeams } from '../../db/queries/teams.js';
import { execa } from 'execa';
import { createPullRequest, type PullRequestRow } from '../../db/queries/pull-requests.js';
import { acquireLock } from '../../db/lock.js';
import { join } from 'path';

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
    const lockPath = join(paths.hiveDir, 'manager.lock');

    // Acquire manager lock to ensure singleton
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      releaseLock = await acquireLock(lockPath, { stale: 120000 }); // 2 min stale threshold
      console.log(chalk.gray('Manager lock acquired'));
    } catch (err) {
      console.error(chalk.red('Failed to acquire manager lock - another manager instance may be running.'));
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

    const interval = parseInt(options.interval, 10) * 1000;
    console.log(chalk.cyan(`Manager started (checking every ${options.interval}s)`));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    const runCheck = async () => {
      try {
        await managerCheck(root);
      } catch (err) {
        console.error(chalk.red('Manager error:'), err);
      }
    };

    await runCheck();

    if (!options.once) {
      setInterval(runCheck, interval);
    } else if (releaseLock) {
      // Release lock immediately if running once
      await releaseLock();
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

    await managerCheck(root);
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

    await nudgeAgent(root, session, options.message);
    console.log(chalk.green(`Nudged ${session}`));
  });

async function managerCheck(root: string): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(chalk.gray(`[${timestamp}] Manager checking...`));

  const paths = getHivePaths(root);
  const db = await getDatabase(paths.hiveDir);

  try {
    // First, run health check to sync agent status with tmux
    const config = loadConfig(paths.hiveDir);
    const scheduler = new Scheduler(db.db, {
      scaling: config.scaling,
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

    for (const session of hiveSessions) {
      // Skip manager itself
      if (session.name === 'hive-manager') continue;

      // Check if agent has unread messages
      const unread = getUnreadMessages(db.db, session.name);
      if (unread.length > 0) {
        await forwardMessages(session.name, unread);
        messagesForwarded += unread.length;
        // Mark as read
        for (const msg of unread) {
          markMessageRead(db.db, msg.id);
        }
        db.save();
      }

      // Check if agent appears stuck (capture last output)
      const output = await captureTmuxPane(session.name, 50);
      const waitingInfo = detectWaitingState(output);

      if (waitingInfo.isWaiting) {
        if (waitingInfo.needsHuman && !escalatedSessions.has(session.name)) {
          // Create escalation for human attention
          const agent = getAgentById(db.db, session.name.replace('hive-', ''));
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
          await sendToTmuxSession(session.name,
            `# REMINDER: You are an autonomous agent. Don't wait for instructions.
# If you completed your task, check for more work:
hive my-stories ${session.name}
# If no stories, check available work: hive my-stories ${session.name} --all
# If you created a PR, make sure to submit it: hive pr submit -b <branch> -s <story-id> --from ${session.name}`
          );

          console.log(chalk.red(`  ESCALATION: ${session.name} needs human input`));
        } else if (!waitingInfo.needsHuman) {
          // Just nudge them
          const agentType = getAgentType(session.name);
          await nudgeAgent(root, session.name, undefined, agentType);
          nudged++;
        }
      }
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
    const rejectedPRs = getPullRequestsByStatus(db.db, 'rejected');
    for (const pr of rejectedPRs) {
      if (pr.submitted_by) {
        const devSession = hiveSessions.find(s => s.name === pr.submitted_by);
        if (devSession) {
          await sendToTmuxSession(devSession.name,
            `# Your PR ${pr.id} was rejected. Reason: ${pr.review_notes || 'See details'}`
          );
        }
      }
    }

    // Check for stories stuck in "in_progress" for too long (> 30 min without activity)
    const stuckStories = queryAll<StoryRow>(db.db,
      `SELECT * FROM stories
       WHERE status = 'in_progress'
       AND updated_at < datetime('now', '-30 minutes')`
    );
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

interface WaitingState {
  isWaiting: boolean;
  needsHuman: boolean;
  reason?: string;
}

function detectWaitingState(output: string): WaitingState {
  // Claude Code UI detection - check status line indicators
  const hasEscToInterrupt = /esc to interrupt/i.test(output);
  const hasBypassPermissions = /bypass permissions/i.test(output);
  const hasThinkingIndicator = /\(thinking\)|Concocting|Twisting|Sautéed|Cooked|Crunched|Brewed/i.test(output);

  // If agent is actively working (has interrupt option or thinking indicator), not waiting
  if (hasEscToInterrupt || hasThinkingIndicator) {
    return { isWaiting: false, needsHuman: false };
  }

  // Patterns that indicate agent needs human input (escalate)
  const humanInputPatterns: Array<{ pattern: RegExp; reason: string }> = [
    // AskUserQuestion UI - numbered options menu
    { pattern: /Enter to select.*↑\/↓ to navigate/i, reason: 'Agent waiting for user selection' },
    { pattern: /❯\s+\d+\.\s+.+\n\s+\d+\./m, reason: 'Agent presenting options menu' },
    // Plan mode approval prompts
    { pattern: /Would you like to proceed\?/i, reason: 'Agent waiting for plan approval' },
    { pattern: /Yes, clear context and bypass/i, reason: 'Agent waiting for plan approval' },
    { pattern: /Yes, manually approve edits/i, reason: 'Agent waiting for plan approval' },
    // Conversational questions
    { pattern: /Could you clarify/i, reason: 'Agent needs clarification' },
    { pattern: /Which option would you prefer/i, reason: 'Agent needs decision' },
    { pattern: /I need.*to proceed/i, reason: 'Agent blocked, needs input' },
    { pattern: /User declined to answer/i, reason: 'Agent was declined, needs guidance' },
  ];

  // Check for human-input-needed patterns first
  for (const { pattern, reason } of humanInputPatterns) {
    if (pattern.test(output)) {
      return { isWaiting: true, needsHuman: true, reason };
    }
  }

  // If at prompt (has bypass permissions line but no activity), agent is idle and can be nudged
  if (hasBypassPermissions) {
    // Check if there's a prompt with text waiting (❯ followed by non-empty content)
    const promptWithInput = /❯\s+[^\n]+\S/m.test(output);
    if (promptWithInput) {
      // There's input at the prompt but no processing - might need Enter or be confused
      return { isWaiting: true, needsHuman: false };
    }

    // Check if agent just finished work
    const finishedPatterns = [
      /work is complete/i,
      /implementation is complete/i,
      /successfully/i,
      /all.*tests pass/i,
      /PR.*created/i,
      /committed/i,
      /is there anything else/i,
      /anything else you'd like/i,
    ];

    for (const pattern of finishedPatterns) {
      if (pattern.test(output)) {
        return { isWaiting: true, needsHuman: false };
      }
    }
  }

  return { isWaiting: false, needsHuman: false };
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
  agentType?: string
): Promise<void> {
  if (customMessage) {
    await sendToTmuxSession(sessionName, customMessage);
    return;
  }

  // For idle agents at empty prompts, just send Enter to trigger continuation
  // Claude Code interprets empty Enter as "continue with your current task"
  // This is more reliable than sending complex multi-line commands
  await sendEnterToTmuxSession(sessionName);
  return;

  // Default nudge based on agent type (kept for reference but not used)
  const type = agentType || getAgentType(sessionName);

  let nudge: string;
  switch (type) {
    case 'qa':
      nudge = `hive pr queue`;
      break;
    case 'senior':
    case 'intermediate':
    case 'junior':
      nudge = `hive my-stories ${sessionName}`;
      break;
    default:
      nudge = `hive status`;
  }

  await sendToTmuxSession(sessionName, nudge);
}

async function forwardMessages(sessionName: string, messages: MessageRow[]): Promise<void> {
  for (const msg of messages) {
    const notification = `# New message from ${msg.from_session}${msg.subject ? ` - ${msg.subject}` : ''}
# ${msg.body}
# Reply with: hive msg reply ${msg.id} "your response" --from ${sessionName}`;

    await sendToTmuxSession(sessionName, notification);
    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

interface DatabaseClient {
  db: import('sql.js').Database;
  save: () => void;
}

async function syncGitHubPRs(root: string, db: DatabaseClient, _hiveDir: string): Promise<number> {
  const teams = getAllTeams(db.db);
  if (teams.length === 0) return 0;

  // Get existing PRs
  const existingPRs = queryAll<PullRequestRow>(db.db,
    "SELECT * FROM pull_requests WHERE status NOT IN ('merged', 'closed')"
  );
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
