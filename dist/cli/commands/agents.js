import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { getAllAgents, getAgentById, getActiveAgents } from '../../db/queries/agents.js';
import { getLogsByAgent } from '../../db/queries/logs.js';
import { statusColor } from '../../utils/logger.js';
export const agentsCommand = new Command('agents')
    .description('Manage agents');
agentsCommand
    .command('list')
    .description('List all agents')
    .option('--active', 'Show only active agents')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        const agents = options.active ? getActiveAgents(db.db) : getAllAgents(db.db);
        if (options.json) {
            console.log(JSON.stringify(agents, null, 2));
            return;
        }
        if (agents.length === 0) {
            console.log(chalk.yellow('No agents found.'));
            return;
        }
        console.log(chalk.bold('\nAgents:\n'));
        // Header
        console.log(chalk.gray(`${'ID'.padEnd(25)} ${'Type'.padEnd(12)} ${'Team'.padEnd(15)} ${'Status'.padEnd(12)} ${'Current Story'}`));
        console.log(chalk.gray('─'.repeat(90)));
        for (const agent of agents) {
            const team = agent.team_id || '-';
            const story = agent.current_story_id || '-';
            console.log(`${chalk.cyan(agent.id.padEnd(25))} ${agent.type.padEnd(12)} ${team.padEnd(15)} ${statusColor(agent.status).padEnd(12)} ${story}`);
        }
        console.log();
    }
    finally {
        db.close();
    }
});
agentsCommand
    .command('logs <agent-id>')
    .description('View agent logs')
    .option('-n, --limit <number>', 'Number of logs to show', '50')
    .option('--json', 'Output as JSON')
    .action(async (agentId, options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        const agent = getAgentById(db.db, agentId);
        if (!agent) {
            console.error(chalk.red(`Agent not found: ${agentId}`));
            process.exit(1);
        }
        const logs = getLogsByAgent(db.db, agentId, parseInt(options.limit, 10));
        if (options.json) {
            console.log(JSON.stringify(logs, null, 2));
            return;
        }
        if (logs.length === 0) {
            console.log(chalk.yellow('No logs found for this agent.'));
            return;
        }
        console.log(chalk.bold(`\nLogs for ${agentId}:\n`));
        for (const log of logs) {
            const time = log.timestamp.substring(0, 19).replace('T', ' ');
            const storyInfo = log.story_id ? chalk.cyan(` [${log.story_id}]`) : '';
            const message = log.message ? `: ${log.message}` : '';
            console.log(`${chalk.gray(time)}${storyInfo} ${chalk.bold(log.event_type)}${message}`);
            if (log.metadata) {
                try {
                    const meta = JSON.parse(log.metadata);
                    console.log(chalk.gray(`  ${JSON.stringify(meta)}`));
                }
                catch {
                    // Ignore parse errors
                }
            }
        }
        console.log();
    }
    finally {
        db.close();
    }
});
agentsCommand
    .command('inspect <agent-id>')
    .description('View detailed agent state')
    .action(async (agentId) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        const agent = getAgentById(db.db, agentId);
        if (!agent) {
            console.error(chalk.red(`Agent not found: ${agentId}`));
            process.exit(1);
        }
        console.log(chalk.bold(`\nAgent: ${agent.id}\n`));
        console.log(chalk.gray(`Type:          ${agent.type}`));
        console.log(chalk.gray(`Team:          ${agent.team_id || '-'}`));
        console.log(chalk.gray(`Status:        ${statusColor(agent.status)}`));
        console.log(chalk.gray(`Tmux Session:  ${agent.tmux_session || '-'}`));
        console.log(chalk.gray(`Current Story: ${agent.current_story_id || '-'}`));
        console.log(chalk.gray(`Created:       ${agent.created_at}`));
        console.log(chalk.gray(`Updated:       ${agent.updated_at}`));
        if (agent.memory_state) {
            console.log(chalk.bold('\nMemory State:'));
            try {
                const state = JSON.parse(agent.memory_state);
                console.log(JSON.stringify(state, null, 2));
            }
            catch {
                console.log(agent.memory_state);
            }
        }
        // Show recent logs
        const logs = getLogsByAgent(db.db, agentId, 5);
        if (logs.length > 0) {
            console.log(chalk.bold('\nRecent Activity:'));
            for (const log of logs) {
                const time = log.timestamp.substring(11, 19);
                const message = log.message ? `: ${log.message.substring(0, 50)}` : '';
                console.log(chalk.gray(`  ${time} | ${log.event_type}${message}`));
            }
        }
        console.log();
    }
    finally {
        db.close();
    }
});
//# sourceMappingURL=agents.js.map