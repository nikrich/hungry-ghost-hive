import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync } from 'fs';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { createRequirement, updateRequirement } from '../../db/queries/requirements.js';
import { createAgent, getTechLead, updateAgent } from '../../db/queries/agents.js';
import { getAllTeams } from '../../db/queries/teams.js';
import { createLog } from '../../db/queries/logs.js';
import { spawnTmuxSession, isTmuxAvailable, sendToTmuxSession } from '../../tmux/manager.js';

export const reqCommand = new Command('req')
  .description('Submit a requirement')
  .argument('[requirement]', 'Requirement text')
  .option('-f, --file <path>', 'Read requirement from file')
  .option('--title <title>', 'Requirement title (defaults to first line)')
  .option('--dry-run', 'Create requirement without spawning agents')
  .action(async (requirement: string | undefined, options: { file?: string; title?: string; dryRun?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);

    // Get requirement text
    let reqText: string;
    if (options.file) {
      if (!existsSync(options.file)) {
        console.error(chalk.red(`File not found: ${options.file}`));
        process.exit(1);
      }
      reqText = readFileSync(options.file, 'utf-8').trim();
    } else if (requirement) {
      reqText = requirement;
    } else {
      console.error(chalk.red('Please provide a requirement or use --file'));
      process.exit(1);
    }

    // Parse title and description
    const lines = reqText.split('\n');
    const title = options.title || lines[0].replace(/^#\s*/, '').substring(0, 100);
    const description = reqText;

    const db = await getDatabase(paths.hiveDir);
    const spinner = ora('Processing requirement...').start();

    try {
      // Check if there are any teams
      const teams = getAllTeams(db.db);
      if (teams.length === 0) {
        spinner.fail(chalk.red('No teams found. Add a repository first:'));
        console.log(chalk.gray('  hive add-repo --url <repo-url> --team <team-name>'));
        process.exit(1);
      }

      // Create requirement
      spinner.text = 'Creating requirement...';
      const req = createRequirement(db.db, { title, description });
      console.log(chalk.green(`\n✓ Requirement created: ${req.id}`));

      if (options.dryRun) {
        console.log(chalk.yellow('Dry run - not spawning agents'));
        spinner.succeed('Requirement created (dry run)');
        return;
      }

      // Check for tmux
      if (!await isTmuxAvailable()) {
        spinner.warn(chalk.yellow('tmux not available - agents will not be spawned'));
        console.log(chalk.gray('Install tmux to enable agent orchestration'));
        return;
      }

      // Get or create Tech Lead agent
      spinner.text = 'Spawning Tech Lead...';
      let techLead = getTechLead(db.db);

      if (!techLead) {
        techLead = createAgent(db.db, { type: 'tech_lead' });
      }

      // Update Tech Lead status
      updateAgent(db.db, techLead.id, { status: 'working' });

      // Log the event
      createLog(db.db, {
        agentId: techLead.id,
        eventType: 'REQUIREMENT_RECEIVED',
        message: title,
        metadata: { requirement_id: req.id },
      });

      // Update requirement status
      updateRequirement(db.db, req.id, { status: 'planning' });

      // Spawn Tech Lead tmux session
      const sessionName = `hive-tech-lead`;
      const techLeadPrompt = generateTechLeadPrompt(req.id, title, description, teams);

      try {
        await spawnTmuxSession({
          sessionName,
          workDir: root,
          command: `claude --dangerously-skip-permissions`,
        });

        // Wait for Claude to fully start, then send the planning prompt
        await new Promise(resolve => setTimeout(resolve, 5000));
        await sendToTmuxSession(sessionName, techLeadPrompt);

        updateAgent(db.db, techLead.id, { tmuxSession: sessionName });

        createLog(db.db, {
          agentId: techLead.id,
          eventType: 'AGENT_SPAWNED',
          message: `Tech Lead spawned for requirement ${req.id}`,
          metadata: { tmux_session: sessionName },
        });

        createLog(db.db, {
          agentId: techLead.id,
          eventType: 'PLANNING_STARTED',
          message: `Planning started for requirement ${req.id}`,
          metadata: { requirement_id: req.id },
        });

        spinner.succeed(chalk.green('Requirement submitted and Tech Lead spawned'));
        console.log();
        console.log(chalk.bold('Requirement:'), req.id);
        console.log(chalk.bold('Title:'), title);
        console.log(chalk.bold('Tech Lead Session:'), sessionName);
        console.log();
        console.log(chalk.gray('View progress:'));
        console.log(chalk.cyan(`  hive status`));
        console.log(chalk.cyan(`  tmux attach -t ${sessionName}`));
        console.log();
      } catch (tmuxErr) {
        spinner.warn(chalk.yellow('Requirement created but failed to spawn Tech Lead'));
        console.error(tmuxErr);
      }
    } catch (err) {
      spinner.fail(chalk.red('Failed to process requirement'));
      console.error(err);
      process.exit(1);
    } finally {
      db.close();
    }
  });

function generateTechLeadPrompt(reqId: string, title: string, description: string, teams: { id: string; name: string; repo_path: string; repo_url: string }[]): string {
  const teamList = teams.map(t => `- ${t.name}: ${t.repo_path} (${t.repo_url})`).join('\n');

  return `You are the Tech Lead of Hive, an AI development team orchestrator.

## New Requirement: ${reqId}

**Title:** ${title}

**Description:**
${description}

## Available Teams
${teamList}

Each team has a local repo_path (relative to the Hive workspace) and a repo_url (GitHub remote).

## Your Task

1. Analyze this requirement
2. Identify which teams/repos are affected
3. **Navigate to the actual repo directories** (e.g., \`cd repos/<team-name>\`) to explore the codebase
4. Break down the requirement into implementable stories
5. Consider dependencies between stories
6. Create a plan for implementation

## Instructions

Use the Hive database to:
1. Create stories using the stories table
2. Assign stories to teams
3. Set up story dependencies
4. Log your progress using agent_logs

The SQLite database is at .hive/hive.db

**IMPORTANT:** Work directly in the team repositories under \`repos/\`. Each team's codebase is a git submodule you can explore, modify, and commit to. Use \`gh\` CLI to interact with GitHub PRs and issues.

When done planning, update the requirement status to 'planned' and each story status to 'estimated' with complexity scores.

Then coordinate with Senior agents to begin implementation.
`;
}

