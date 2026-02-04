#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import {
  initCommand,
  configCommand,
  addRepoCommand,
  teamsCommand,
  reqCommand,
  statusCommand,
  agentsCommand,
  storiesCommand,
  escalationsCommand,
  resumeCommand,
  assignCommand,
  nukeCommand,
  msgCommand,
  myStoriesCommand,
} from './cli/commands/index.js';

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

// Dashboard command
program
  .command('dashboard')
  .description('Open TUI dashboard')
  .option('-r, --refresh <ms>', 'Refresh interval in milliseconds', '5000')
  .action(async (options: { refresh: string }) => {
    try {
      const { startDashboard } = await import('./cli/dashboard/index.js');
      startDashboard({ refreshInterval: parseInt(options.refresh, 10) });
    } catch (err) {
      console.error(chalk.red('Failed to start dashboard:'), err);
      console.log(chalk.gray('Make sure blessed is installed: npm install blessed'));
      process.exit(1);
    }
  });

// Parse and run
program.parse();
