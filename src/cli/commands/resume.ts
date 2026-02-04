import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { getAllAgents, updateAgent, type AgentRow } from '../../db/queries/agents.js';
import { createLog } from '../../db/queries/logs.js';
import { spawnTmuxSession, isTmuxAvailable, isTmuxSessionRunning } from '../../tmux/manager.js';

export const resumeCommand = new Command('resume')
  .description('Resume agents from saved state')
  .option('--agent <id>', 'Resume a specific agent')
  .option('--all', 'Resume all non-terminated agents')
  .action(async (options: { agent?: string; all?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    if (!await isTmuxAvailable()) {
      console.error(chalk.red('tmux is not available. Please install tmux to use agent features.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = getDatabase(paths.hiveDir);

    try {
      let agentsToResume: AgentRow[];

      if (options.agent) {
        const agent = db.db.prepare('SELECT * FROM agents WHERE id = ?').get(options.agent) as AgentRow | undefined;
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
          const sessionName = agent.tmux_session || `hive-${agent.type}${agent.team_id ? `-${agent.team_id}` : ''}`;

          if (await isTmuxSessionRunning(sessionName)) {
            spinner.info(chalk.yellow(`${agent.id} session already running: ${sessionName}`));
            continue;
          }

          // Determine work directory
          let workDir = root;
          if (agent.team_id) {
            const team = db.db.prepare('SELECT * FROM teams WHERE id = ?').get(agent.team_id) as { repo_path: string } | undefined;
            if (team) {
              workDir = `${root}/${team.repo_path}`;
            }
          }

          // Spawn new session
          await spawnTmuxSession({
            sessionName,
            workDir,
            command: `claude --resume ${sessionName}`,
          });

          // Update agent state
          updateAgent(db.db, agent.id, {
            status: 'working',
            tmuxSession: sessionName,
          });

          // Log the resume event
          createLog(db.db, {
            agentId: agent.id,
            storyId: agent.current_story_id,
            eventType: 'AGENT_RESUMED',
            message: `Resumed from checkpoint`,
            metadata: { tmux_session: sessionName },
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
    } finally {
      db.close();
    }
  });
