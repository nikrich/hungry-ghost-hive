#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { initCommand, configCommand, addRepoCommand, teamsCommand, reqCommand, statusCommand, agentsCommand, storiesCommand, escalationsCommand, resumeCommand, assignCommand, nukeCommand, msgCommand, myStoriesCommand, prCommand, managerCommand, } from './cli/commands/index.js';
const program = new Command();
program
    .name('hive')
    .description('AI Agent Orchestrator - Manage agile software development teams of AI agents')
    .version('0.1.0');
// Core commands
program.addCommand(initCommand);
program.addCommand(configCommand);
// Repository and team management
program.addCommand(addRepoCommand);
program.addCommand(teamsCommand);
// Requirement and workflow
program.addCommand(reqCommand);
program.addCommand(statusCommand);
program.addCommand(resumeCommand);
program.addCommand(assignCommand);
// Entity management
program.addCommand(agentsCommand);
program.addCommand(storiesCommand);
program.addCommand(escalationsCommand);
// Destructive operations
program.addCommand(nukeCommand);
// Communication
program.addCommand(msgCommand);
// Agent workflow
program.addCommand(myStoriesCommand);
// PR and merge queue
program.addCommand(prCommand);
// Manager (micromanager daemon)
program.addCommand(managerCommand);
// Dashboard command
program
    .command('dashboard')
    .description('Open TUI dashboard')
    .option('-r, --refresh <ms>', 'Refresh interval in milliseconds', '5000')
    .action(async (options) => {
    try {
        // Ensure higher Node heap specifically for the dashboard by re-spawning with --max-old-space-size if not already set
        const hasHeapFlag = process.execArgv.some(arg => arg.startsWith('--max-old-space-size'));
        const desiredMb = parseInt(process.env.HIVE_DASHBOARD_HEAP_MB || '4096', 10);
        if (!hasHeapFlag) {
            const args = [`--max-old-space-size=${desiredMb}`, process.argv[1], 'dashboard', '--refresh', String(options.refresh)];
            const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
            process.exit(result.status === null ? 1 : result.status);
        }
        const { startDashboard } = await import('./cli/dashboard/index.js');
        startDashboard({ refreshInterval: parseInt(options.refresh, 10) });
    }
    catch (err) {
        console.error(chalk.red('Failed to start dashboard:'), err);
        console.log(chalk.gray('Make sure blessed is installed: npm install blessed'));
        process.exit(1);
    }
});
// Parse and run
program.parse();
//# sourceMappingURL=index.js.map