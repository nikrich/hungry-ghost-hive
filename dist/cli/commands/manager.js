import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { getHiveSessions, sendToTmuxSession, captureTmuxPane, isManagerRunning, stopManager as stopManagerSession } from '../../tmux/manager.js';
import { getMergeQueue, getPullRequestsByStatus } from '../../db/queries/pull-requests.js';
import { getUnreadMessages, markMessageRead } from '../../db/queries/messages.js';
import { queryAll } from '../../db/client.js';
export const managerCommand = new Command('manager')
    .description('Micromanager daemon that keeps agents productive');
// Start the manager daemon
managerCommand
    .command('start')
    .description('Start the manager daemon (runs every 60s)')
    .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
    .option('--once', 'Run once and exit')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace.'));
        process.exit(1);
    }
    const interval = parseInt(options.interval, 10) * 1000;
    console.log(chalk.cyan(`Manager started (checking every ${options.interval}s)`));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    const runCheck = async () => {
        try {
            await managerCheck(root);
        }
        catch (err) {
            console.error(chalk.red('Manager error:'), err);
        }
    };
    await runCheck();
    if (!options.once) {
        setInterval(runCheck, interval);
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
        }
        else {
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
    }
    finally {
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
    }
    else {
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
    }
    else {
        console.log(chalk.yellow('Manager daemon was not running'));
    }
});
// Nudge a specific agent
managerCommand
    .command('nudge <session>')
    .description('Nudge an agent to check for work')
    .option('-m, --message <msg>', 'Custom message to send')
    .action(async (session, options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace.'));
        process.exit(1);
    }
    await nudgeAgent(root, session, options.message);
    console.log(chalk.green(`Nudged ${session}`));
});
async function managerCheck(root) {
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
        const sessions = await getHiveSessions();
        const hiveSessions = sessions.filter(s => s.name.startsWith('hive-') &&
            !s.name.includes('tech-lead') // Don't micromanage the tech lead
        );
        if (hiveSessions.length === 0) {
            console.log(chalk.gray('  No agent sessions found'));
            return;
        }
        let nudged = 0;
        let messagesForwarded = 0;
        for (const session of hiveSessions) {
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
            const output = await captureTmuxPane(session.name, 30);
            const isWaiting = detectWaitingState(output);
            if (isWaiting) {
                // Determine what to nudge them about
                const agentType = getAgentType(session.name);
                await nudgeAgent(root, session.name, undefined, agentType);
                nudged++;
            }
        }
        // Check for PRs needing QA attention
        const queuedPRs = getMergeQueue(db.db);
        if (queuedPRs.length > 0) {
            const qaSessions = hiveSessions.filter(s => s.name.includes('-qa-'));
            for (const qa of qaSessions) {
                await sendToTmuxSession(qa.name, `# ${queuedPRs.length} PR(s) waiting in queue. Run: hive pr queue`);
            }
        }
        // Check for rejected PRs that need developer attention
        const rejectedPRs = getPullRequestsByStatus(db.db, 'rejected');
        for (const pr of rejectedPRs) {
            if (pr.submitted_by) {
                const devSession = hiveSessions.find(s => s.name === pr.submitted_by);
                if (devSession) {
                    await sendToTmuxSession(devSession.name, `# Your PR ${pr.id} was rejected. Reason: ${pr.review_notes || 'See details'}`);
                }
            }
        }
        // Check for unassigned planned stories
        const plannedStories = queryAll(db.db, "SELECT * FROM stories WHERE status = 'planned' AND assigned_agent_id IS NULL");
        if (plannedStories.length > 0) {
            // Notify seniors about unassigned work
            const seniorSessions = hiveSessions.filter(s => s.name.includes('-senior-'));
            for (const senior of seniorSessions) {
                await sendToTmuxSession(senior.name, `# ${plannedStories.length} unassigned story(ies). Run: hive my-stories ${senior.name} --all`);
            }
        }
        // Summary
        const summary = [];
        if (nudged > 0)
            summary.push(`${nudged} nudged`);
        if (messagesForwarded > 0)
            summary.push(`${messagesForwarded} messages forwarded`);
        if (queuedPRs.length > 0)
            summary.push(`${queuedPRs.length} PRs queued`);
        if (summary.length > 0) {
            console.log(chalk.yellow(`  ${summary.join(', ')}`));
        }
        else {
            console.log(chalk.green('  All agents productive'));
        }
    }
    finally {
        db.close();
    }
}
function detectWaitingState(output) {
    const waitingPatterns = [
        /waiting for.*input/i,
        /press enter to continue/i,
        /\?\s*$/, // Ends with a question
        /y\/n\s*\]?\s*$/i, // Yes/No prompt
        /\[Y\/n\]/i,
        /\(yes\/no\)/i,
        /password:/i,
        /enter .*:/i,
        /would you like to/i,
        /do you want to/i,
        /please confirm/i,
        /waiting for response/i,
    ];
    // Check for Claude asking questions (common patterns)
    const claudeQuestionPatterns = [
        /I have a few questions/i,
        /Could you clarify/i,
        /Which option would you prefer/i,
        /Should I proceed/i,
        /Do you want me to/i,
        /Let me know if/i,
    ];
    for (const pattern of [...waitingPatterns, ...claudeQuestionPatterns]) {
        if (pattern.test(output)) {
            return true;
        }
    }
    return false;
}
function getAgentType(sessionName) {
    if (sessionName.includes('-senior-'))
        return 'senior';
    if (sessionName.includes('-intermediate-'))
        return 'intermediate';
    if (sessionName.includes('-junior-'))
        return 'junior';
    if (sessionName.includes('-qa-'))
        return 'qa';
    return 'unknown';
}
async function nudgeAgent(_root, sessionName, customMessage, agentType) {
    if (customMessage) {
        await sendToTmuxSession(sessionName, customMessage);
        return;
    }
    // Default nudge based on agent type
    const type = agentType || getAgentType(sessionName);
    let nudge;
    switch (type) {
        case 'qa':
            nudge = `# Manager check-in: Review the merge queue
hive pr queue
# If PRs waiting, claim one: hive pr review --from ${sessionName}`;
            break;
        case 'senior':
        case 'intermediate':
        case 'junior':
            nudge = `# Manager check-in: Check your assignments
hive my-stories ${sessionName}
# Check messages: hive msg inbox ${sessionName}`;
            break;
        default:
            nudge = `# Manager check-in: Status check
hive status`;
    }
    await sendToTmuxSession(sessionName, nudge);
}
async function forwardMessages(sessionName, messages) {
    for (const msg of messages) {
        const notification = `# New message from ${msg.from_session}${msg.subject ? ` - ${msg.subject}` : ''}
# ${msg.body}
# Reply with: hive msg reply ${msg.id} "your response" --from ${sessionName}`;
        await sendToTmuxSession(sessionName, notification);
        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}
//# sourceMappingURL=manager.js.map