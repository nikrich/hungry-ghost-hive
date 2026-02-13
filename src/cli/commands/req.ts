// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import ora from 'ora';
import readline from 'readline';
import { getCliRuntimeBuilder, resolveRuntimeModelForCli } from '../../cli-runtimes/index.js';
import { fetchLocalClusterStatus } from '../../cluster/runtime.js';
import { loadConfig } from '../../config/loader.js';
import { registry } from '../../connectors/registry.js';
import { withTransaction } from '../../db/client.js';
import { createAgent, getTechLead, updateAgent } from '../../db/queries/agents.js';
import { createLog } from '../../db/queries/logs.js';
import { createRequirement, updateRequirement } from '../../db/queries/requirements.js';
import { getAllTeams } from '../../db/queries/teams.js';
import { isTmuxAvailable, spawnTmuxSession } from '../../tmux/manager.js';
import { withHiveContext } from '../../utils/with-hive-context.js';
import { startDashboard } from '../dashboard/index.js';

export const reqCommand = new Command('req')
  .description('Submit a requirement')
  .argument('[requirement]', 'Requirement text')
  .option('-f, --file <path>', 'Read requirement from file')
  .option('--title <title>', 'Requirement title (defaults to first line)')
  .option('--dry-run', 'Create requirement without spawning agents')
  .option('--godmode', 'Enable godmode - use most powerful models for all agents')
  .option('--target-branch <branch>', 'Target branch for PRs (skips interactive prompt)')
  .action(
    async (
      requirement: string | undefined,
      options: {
        file?: string;
        title?: string;
        dryRun?: boolean;
        godmode?: boolean;
        targetBranch?: string;
      }
    ) => {
      await withHiveContext(async ({ root, paths, db }) => {
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

        const config = loadConfig(paths.hiveDir);

        // Check if the input is an epic URL from a configured PM provider
        let title: string;
        let description: string;
        let jiraEpicKey: string | undefined;
        let jiraEpicId: string | undefined;

        const pmProvider = config.integrations.project_management.provider;
        const pmConnector =
          pmProvider !== 'none' ? registry.getProjectManagement(pmProvider) : null;

        // Validate epic URL before processing
        const detectedProvider = detectEpicUrlProvider(reqText);
        if (detectedProvider) {
          // URL is an epic URL for some provider
          if (pmProvider === 'none') {
            console.error(
              chalk.red(
                `Epic URL detected but project management is not configured.`
              )
            );
            console.log(
              chalk.gray(
                `This looks like a ${detectedProvider} epic URL, but PM provider is set to 'none'.`
              )
            );
            console.log(
              chalk.gray(
                `Configure a PM provider by running: hive init`
              )
            );
            process.exit(1);
          }

          if (detectedProvider !== pmProvider) {
            console.error(
              chalk.red(
                `Epic URL provider mismatch: expected ${pmProvider}, got ${detectedProvider}`
              )
            );
            console.log(
              chalk.gray(
                `Your project management provider is configured as '${pmProvider}', but this URL is from '${detectedProvider}'.`
              )
            );
            console.log(
              chalk.gray(
                `Either use a ${pmProvider} epic URL or reconfigure your PM provider with: hive init`
              )
            );
            process.exit(1);
          }
        }

        if (pmConnector && pmConnector.isEpicUrl(reqText)) {
          const parsed = pmConnector.parseEpicUrl(reqText);
          if (!parsed) {
            console.error(chalk.red('Could not parse epic URL.'));
            process.exit(1);
          }

          const spinner = ora(`Fetching epic ${parsed.issueKey} from ${pmConnector.provider}...`).start();
          try {
            const epic = await pmConnector.fetchEpic(reqText);
            title = options.title || epic.title.substring(0, 100);
            description = epic.description;
            jiraEpicKey = epic.key;
            jiraEpicId = epic.id;

            spinner.succeed(chalk.green(`Fetched epic: ${epic.key} — ${epic.title}`));
          } catch (err) {
            spinner.fail(chalk.red(`Failed to fetch epic from ${pmConnector.provider}`));
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        } else {
          // Plain text requirement — existing behavior
          const lines = reqText.split('\n');
          title = options.title || lines[0].replace(/^#\s*/, '').substring(0, 100);
          description = reqText;
        }

        // Determine target branch
        let targetBranch: string;
        if (options.targetBranch) {
          targetBranch = options.targetBranch;
        } else if (process.stdin.isTTY) {
          targetBranch = await promptTargetBranch();
        } else {
          targetBranch = 'main';
        }
        if (config.cluster.enabled) {
          const clusterStatus = await fetchLocalClusterStatus(config.cluster);
          if (!clusterStatus) {
            console.error(
              chalk.red(
                'Cluster mode is enabled, but local cluster runtime is unavailable. Start manager first:'
              )
            );
            console.log(chalk.gray('  hive manager start'));
            process.exit(1);
          }

          if (!clusterStatus.is_leader) {
            console.error(
              chalk.red(
                `This node is not the active cluster leader (leader: ${clusterStatus.leader_id || 'unknown'}).`
              )
            );
            if (clusterStatus.leader_url) {
              console.log(
                chalk.gray(`Run this command on leader host: ${clusterStatus.leader_url}`)
              );
            }
            process.exit(1);
          }
        }

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
          const req = createRequirement(db.db, {
            title,
            description,
            godmode: options.godmode,
            targetBranch,
          });

          // If this came from a Jira epic URL, store the epic key/id
          if (jiraEpicKey && jiraEpicId) {
            updateRequirement(db.db, req.id, {
              jiraEpicKey,
              jiraEpicId,
            });
          }

          console.log(chalk.green(`\n✓ Requirement created: ${req.id}`));
          if (options.godmode) {
            console.log(chalk.yellow('⚡ GODMODE enabled - using Opus 4.6 for all agents'));
          }
          if (targetBranch !== 'main') {
            console.log(chalk.cyan(`🎯 Target branch: ${targetBranch}`));
          }

          if (options.dryRun) {
            console.log(chalk.yellow('Dry run - not spawning agents'));
            spinner.succeed('Requirement created (dry run)');
            return;
          }

          // Check for tmux
          if (!(await isTmuxAvailable())) {
            spinner.warn(chalk.yellow('tmux not available - agents will not be spawned'));
            console.log(chalk.gray('Install tmux to enable agent orchestration'));
            return;
          }

          // Get or create Tech Lead agent
          spinner.text = 'Spawning Tech Lead...';
          let techLead = getTechLead(db.db);
          const techLeadCliTool = config.models.tech_lead.cli_tool;
          const techLeadSafetyMode = config.models.tech_lead.safety_mode;
          const techLeadModel = resolveRuntimeModelForCli(
            config.models.tech_lead.model,
            techLeadCliTool
          );

          if (!techLead) {
            techLead = createAgent(db.db, { type: 'tech_lead', model: techLeadModel });
          }

          // Update Tech Lead status and log event (atomic transaction)
          await withTransaction(db.db, () => {
            updateAgent(db.db, techLead.id, { status: 'working' });

            createLog(db.db, {
              agentId: techLead.id,
              eventType: 'REQUIREMENT_RECEIVED',
              message: title,
              metadata: { requirement_id: req.id, godmode: req.godmode ? true : false },
            });

            updateRequirement(db.db, req.id, { status: 'planning' });
          });

          // Spawn Tech Lead tmux session
          const sessionName = `hive-tech-lead`;
          const techLeadPrompt = generateTechLeadPrompt(
            req.id,
            title,
            description,
            teams,
            options.godmode,
            targetBranch
          );

          try {
            // Build CLI command using the configured runtime for Tech Lead
            const commandArgs = getCliRuntimeBuilder(techLeadCliTool).buildSpawnCommand(
              techLeadModel,
              techLeadSafetyMode
            );

            // Pass the prompt as initialPrompt so it's included as a CLI positional
            // argument via $(cat ...). This delivers the full multi-line prompt
            // reliably without tmux send-keys newline issues.
            await spawnTmuxSession({
              sessionName,
              workDir: root,
              commandArgs,
              initialPrompt: techLeadPrompt,
            });

            // Update agent and log spawning/planning events (atomic transaction)
            await withTransaction(db.db, () => {
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

            // Launch dashboard
            try {
              await startDashboard();
            } catch (dashboardErr) {
              console.warn(chalk.yellow('⚠️  Failed to start dashboard'));
              console.error(dashboardErr);
            }
          } catch (tmuxErr) {
            spinner.warn(chalk.yellow('Requirement created but failed to spawn Tech Lead'));
            console.error(tmuxErr);
          }
        } catch (err) {
          spinner.fail(chalk.red('Failed to process requirement'));
          console.error(err);
          process.exit(1);
        }
      });
    }
  );

/**
 * Detect which PM provider an epic URL belongs to by checking all registered providers.
 * @param url - The URL to check
 * @returns The provider name if the URL matches a registered provider, null otherwise
 */
function detectEpicUrlProvider(url: string): string | null {
  const providers = registry.listProjectManagementProviders();
  for (const provider of providers) {
    const connector = registry.getProjectManagement(provider);
    if (connector && connector.isEpicUrl(url)) {
      return provider;
    }
  }
  return null;
}

async function promptTargetBranch(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    console.log(chalk.bold('\n? Target branch for PRs:'));
    console.log('  1) main (default)');
    console.log('  2) Custom branch...');
    rl.question(chalk.gray('  Choice [1]: '), answer => {
      const choice = answer.trim();
      if (choice === '2') {
        rl.question(chalk.gray('  Enter target branch name: '), branchName => {
          rl.close();
          const branch = branchName.trim();
          resolve(branch || 'main');
        });
      } else {
        rl.close();
        resolve('main');
      }
    });
  });
}

function generateTechLeadPrompt(
  reqId: string,
  title: string,
  description: string,
  teams: { id: string; name: string; repo_path: string; repo_url: string }[],
  godmode?: boolean,
  targetBranch?: string
): string {
  const teamList = teams.map(t => `- ${t.name}: ${t.repo_path} (${t.repo_url})`).join('\n');
  const godmodeNotice = godmode
    ? `

⚡ **GODMODE ENABLED** ⚡
This requirement is running in GODMODE. All agents will use claude-opus-4-6 (the most powerful model) for maximum capability and quality. Use this power wisely for complex, critical work.
`
    : '';
  const branch = targetBranch || 'main';
  const targetBranchNotice =
    branch !== 'main'
      ? `
**Target Branch:** ${branch}
All PRs for this requirement should target \`${branch}\` instead of \`main\`. Feature branches should be based on \`origin/${branch}\`.
`
      : '';

  return `You are the Tech Lead of Hive, an AI development team orchestrator.

## New Requirement: ${reqId}
${godmodeNotice}${targetBranchNotice}
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

## Workflow

1. **Analyze the requirement** - Explore the affected repos to understand what needs to change
2. **Create stories in the database** - Insert into the stories table with team_id, complexity_score, and status='estimated'
3. **Run \`hive assign\`** - This spawns Senior agents for each team and assigns stories to them
4. **Monitor progress** - Use \`hive status\` and \`hive agents list\` to track work
5. **Check messages regularly** - Developers may have questions for you

## Communication with Developers

Check your inbox for messages from developers:
\`\`\`bash
hive msg inbox hive-tech-lead
\`\`\`

Read a specific message:
\`\`\`bash
hive msg read <msg-id>
\`\`\`

Reply to a message:
\`\`\`bash
hive msg reply <msg-id> "Your response here"
\`\`\`

**IMPORTANT:** Periodically run \`hive msg inbox hive-tech-lead\` to check if any developers need guidance. Answer their questions promptly to keep the team unblocked.

When done planning, update the requirement status to 'planned' and run \`hive assign\` to spawn Senior developers who will implement the stories.
`;
}
