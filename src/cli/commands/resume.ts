import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { getCliRuntimeBuilder, resolveRuntimeModelForCli } from '../../cli-runtimes/index.js';
import { loadConfig } from '../../config/index.js';
import { withTransaction } from '../../db/client.js';
import { getAgentById, getAllAgents, updateAgent, type AgentRow } from '../../db/queries/agents.js';
import { createLog } from '../../db/queries/logs.js';
import { getTeamById } from '../../db/queries/teams.js';
import { isTmuxAvailable, isTmuxSessionRunning, spawnTmuxSession } from '../../tmux/manager.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const resumeCommand = new Command('resume')
  .description('Resume agents from saved state')
  .option('--agent <id>', 'Resume a specific agent')
  .option('--all', 'Resume all non-terminated agents')
  .action(async (options: { agent?: string; all?: boolean }) => {
    await withHiveContext(async ({ root, paths, db }) => {
      if (!(await isTmuxAvailable())) {
        console.error(
          chalk.red('tmux is not available. Please install tmux to use agent features.')
        );
        process.exit(1);
      }

      const config = loadConfig(paths.hiveDir);

      let agentsToResume: AgentRow[];

      if (options.agent) {
        const agent = getAgentById(db.db, options.agent);
        if (!agent) {
          console.error(chalk.red(`Agent not found: ${options.agent}`));
          process.exit(1);
        }
        if (agent.status === 'terminated') {
          console.error(chalk.red('Cannot resume a terminated agent'));
          process.exit(1);
        }
        agentsToResume = [agent];
      } else if (options.all) {
        agentsToResume = getAllAgents(db.db).filter(a => a.status !== 'terminated');
      } else {
        // Default: resume blocked or idle agents that have memory state
        agentsToResume = getAllAgents(db.db).filter(
          a => a.status !== 'terminated' && a.memory_state
        );
      }

      if (agentsToResume.length === 0) {
        console.log(chalk.yellow('No agents to resume.'));
        return;
      }

      console.log(chalk.bold(`\nResuming ${agentsToResume.length} agent(s)...\n`));

      for (const agent of agentsToResume) {
        const spinner = ora(`Resuming ${agent.id}...`).start();

        try {
          // Check if session is already running
          const sessionName =
            agent.tmux_session || `hive-${agent.type}${agent.team_id ? `-${agent.team_id}` : ''}`;

          if (await isTmuxSessionRunning(sessionName)) {
            spinner.info(chalk.yellow(`${agent.id} session already running: ${sessionName}`));
            continue;
          }

          // Determine work directory
          let workDir = root;
          if (agent.team_id) {
            const team = getTeamById(db.db, agent.team_id);
            if (team) {
              workDir = `${root}/${team.repo_path}`;
            }
          }

          // Get CLI runtime configuration for this agent type
          const agentConfig = config.models[agent.type];
          const cliTool = agentConfig.cli_tool;
          const model = resolveRuntimeModelForCli(agent.model || agentConfig.model, cliTool);

          // Build resume command using CLI runtime builder
          const runtimeBuilder = getCliRuntimeBuilder(cliTool);
          const commandArray = runtimeBuilder.buildResumeCommand(model, sessionName);
          const command = commandArray.join(' ');

          // Spawn new session
          await spawnTmuxSession({
            sessionName,
            workDir,
            command,
          });

          // Update agent state and log event (atomic transaction)
          await withTransaction(db.db, () => {
            updateAgent(db.db, agent.id, {
              status: 'working',
              tmuxSession: sessionName,
            });

            createLog(db.db, {
              agentId: agent.id,
              storyId: agent.current_story_id,
              eventType: 'AGENT_RESUMED',
              message: `Resumed from checkpoint`,
              metadata: { tmux_session: sessionName },
            });
          });

          spinner.succeed(chalk.green(`${agent.id} resumed: ${sessionName}`));
        } catch (err) {
          spinner.fail(chalk.red(`Failed to resume ${agent.id}`));
          console.error(err);
        }
      }

      console.log(chalk.gray('\nView agent sessions:'));
      console.log(chalk.cyan('  tmux list-sessions'));
      console.log(chalk.cyan('  hive agents list --active'));
    });
  });
