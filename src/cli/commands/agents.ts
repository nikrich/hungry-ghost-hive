import chalk from 'chalk';
import { Command } from 'commander';
import {
  deleteAgent,
  getActiveAgents,
  getAgentById,
  getAgentsByStatus,
  getAllAgents,
} from '../../db/queries/agents.js';
import { getLogsByAgent } from '../../db/queries/logs.js';
import { statusColor } from '../../utils/logger.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const agentsCommand = new Command('agents').description('Manage agents');

agentsCommand
  .command('list')
  .description('List all agents')
  .option('--active', 'Show only active agents')
  .option('--json', 'Output as JSON')
  .action(async (options: { active?: boolean; json?: boolean }) => {
    await withHiveContext(({ db }) => {
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
      console.log(
        chalk.gray(
          `${'ID'.padEnd(25)} ${'Type'.padEnd(12)} ${'Model'.padEnd(10)} ${'Team'.padEnd(15)} ${'Status'.padEnd(12)} ${'Current Story'}`
        )
      );
      console.log(chalk.gray('─'.repeat(100)));

      for (const agent of agents) {
        const team = agent.team_id || '-';
        const story = agent.current_story_id || '-';
        const model = agent.model || '-';
        console.log(
          `${chalk.cyan(agent.id.padEnd(25))} ${agent.type.padEnd(12)} ${model.padEnd(10)} ${team.padEnd(15)} ${statusColor(agent.status).padEnd(12)} ${story}`
        );
      }
      console.log();
    });
  });

agentsCommand
  .command('logs <agent-id>')
  .description('View agent logs')
  .option('-n, --limit <number>', 'Number of logs to show', '50')
  .option('--json', 'Output as JSON')
  .action(async (agentId: string, options: { limit: string; json?: boolean }) => {
    await withHiveContext(({ db }) => {
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
          } catch {
            // Ignore parse errors
          }
        }
      }
      console.log();
    });
  });

agentsCommand
  .command('inspect <agent-id>')
  .description('View detailed agent state')
  .action(async (agentId: string) => {
    await withHiveContext(({ db }) => {
      const agent = getAgentById(db.db, agentId);
      if (!agent) {
        console.error(chalk.red(`Agent not found: ${agentId}`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nAgent: ${agent.id}\n`));
      console.log(chalk.gray(`Type:          ${agent.type}`));
      console.log(chalk.gray(`Model:         ${agent.model || '-'}`));
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
        } catch {
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
    });
  });

agentsCommand
  .command('cleanup')
  .description('Clean up terminated agents from the database')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .action(async (options: { dryRun?: boolean }) => {
    await withHiveContext(async ({ root, db }) => {
      const terminatedAgents = getAgentsByStatus(db.db, 'terminated');

      if (terminatedAgents.length === 0) {
        console.log(chalk.green('No terminated agents to clean up.'));
        return;
      }

      console.log(chalk.yellow(`\nFound ${terminatedAgents.length} terminated agent(s):\n`));

      // Group by type for summary
      const byType = terminatedAgents.reduce(
        (acc, agent) => {
          acc[agent.type] = (acc[agent.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      for (const [type, count] of Object.entries(byType)) {
        console.log(chalk.gray(`  ${type}: ${count}`));
      }
      console.log();

      if (options.dryRun) {
        console.log(chalk.yellow('Dry run - no agents were deleted.'));
        return;
      }

      // Delete terminated agents and their worktrees
      let deleted = 0;
      for (const agent of terminatedAgents) {
        try {
          // Remove worktree if exists
          if (agent.worktree_path) {
            try {
              const { execSync } = await import('child_process');
              const fullWorktreePath = `${root}/${agent.worktree_path}`;
              execSync(`git worktree remove "${fullWorktreePath}" --force`, {
                cwd: root,
                stdio: 'pipe',
              });
            } catch (err) {
              console.error(
                chalk.yellow(
                  `Warning: Failed to remove worktree for ${agent.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
                )
              );
            }
          }

          deleteAgent(db.db, agent.id);
          deleted++;
        } catch (err) {
          console.error(
            chalk.red(
              `Failed to delete ${agent.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
            )
          );
        }
      }

      console.log(chalk.green(`✓ Cleaned up ${deleted} terminated agent(s).`));
    });
  });
