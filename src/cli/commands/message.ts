// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { execSync } from 'child_process';
import { Command } from 'commander';
import { nanoid } from 'nanoid';
import { getCliRuntimeBuilder } from '../../cli-runtimes/index.js';
import { loadConfig } from '../../config/loader.js';
import { createAgent, getAgentById, getAllAgents, type AgentRow } from '../../db/queries/agents.js';
import { getPendingRequirements } from '../../db/queries/requirements.js';
import { getAllTeams } from '../../db/queries/teams.js';
import {
  isTmuxSessionRunning,
  sendMessageWithConfirmation,
  spawnTmuxSession,
} from '../../tmux/manager.js';
import { buildInstanceSessionName, getTechLeadSessionName } from '../../utils/instance.js';
import { getParentMcpConfig } from '../../utils/mcp-config.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const messageCommand = new Command('message').description(
  'Send messages directly to agent tmux sessions'
);

messageCommand
  .argument('[text]', 'Message text to send to the agent')
  .option('-a, --agent <agentId>', 'Agent ID (or partial match)')
  .option('-n, --new', 'Spawn a new interactive chat agent')
  .option('-f, --from <session>', 'Your session name (defaults to tech lead session)')
  .action(
    async (text: string | undefined, options: { agent?: string; new?: boolean; from?: string }) => {
      if (options.new) {
        await handleNewAgent(options.from);
      } else if (options.agent) {
        if (!text) {
          console.error(chalk.red('Message text is required when using --agent'));
          process.exit(1);
        }
        await handleSendMessage(text, options.agent, options.from);
      } else {
        console.error(chalk.red('Either --agent <id> or --new is required'));
        process.exit(1);
      }
    }
  );

async function handleSendMessage(text: string, agentId: string, from?: string): Promise<void> {
  await withHiveContext(async ({ db, paths }) => {
    const fromSession = from || getTechLeadSessionName(paths.hiveDir);

    // Look up agent by exact ID or partial match
    const agent = await resolveAgent(db.provider, agentId);

    if (!agent) {
      console.error(chalk.red(`No agent found matching: ${agentId}`));
      process.exit(1);
    }

    if (!agent.tmux_session) {
      console.error(chalk.red(`Agent ${agent.id} has no tmux session assigned`));
      process.exit(1);
    }

    // Verify tmux session is running
    const isRunning = await isTmuxSessionRunning(agent.tmux_session);
    if (!isRunning) {
      console.error(
        chalk.red(`Tmux session '${agent.tmux_session}' for agent ${agent.id} is not running`)
      );
      process.exit(1);
    }

    // Send message directly to the agent's tmux session
    const delivered = await sendMessageWithConfirmation(agent.tmux_session, text);

    // Store in messages table for audit trail
    const msgId = `msg-${nanoid(8)}`;
    const now = new Date().toISOString();
    await db.provider.run(
      `INSERT INTO messages (id, from_session, to_session, subject, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'read', ?)`,
      [msgId, fromSession, agent.tmux_session, null, text, now]
    );
    db.save();

    if (delivered) {
      console.log(chalk.green(`Message delivered to ${agent.id} (${agent.tmux_session})`));
    } else {
      console.log(
        chalk.yellow(
          `Message sent to ${agent.id} (${agent.tmux_session}) but delivery not confirmed`
        )
      );
    }
    console.log(chalk.gray(`Audit trail: ${msgId}`));
  });
}

async function handleNewAgent(_from?: string): Promise<void> {
  await withHiveContext(async ({ db, paths, root }) => {
    const config = loadConfig(paths.hiveDir);
    const modelConfig = config.models.senior;
    const cliTool = modelConfig.cli_tool || 'claude';

    // Find the first team to get repo info for the worktree
    const teams = await getAllTeams(db.provider);
    if (teams.length === 0) {
      console.error(chalk.red('No teams found. Run "hive init" and add a repository first.'));
      process.exit(1);
    }
    const team = teams[0];

    // Create agent record in DB
    const agent = await createAgent(db.provider, {
      type: 'senior',
      teamId: team.id,
    });

    // Build session name
    const sessionName = buildInstanceSessionName(paths.hiveDir, 'chat', team.name);

    // Create git worktree
    const worktreePath = `repos/${team.id}-${agent.id}`;
    const fullWorktreePath = `${root}/${worktreePath}`;
    const fullRepoPath = `${root}/${team.repo_path}`;
    const branchName = `agent/${agent.id}`;

    try {
      execSync(`git fetch origin main`, {
        cwd: fullRepoPath,
        stdio: 'pipe',
        timeout: 5000,
      });
    } catch {
      // Fetch failure is non-fatal
    }

    try {
      execSync(`git worktree add "${fullWorktreePath}" -b "${branchName}" "origin/main"`, {
        cwd: fullRepoPath,
        stdio: 'pipe',
        timeout: 30000,
      });
    } catch {
      try {
        execSync(`git worktree add "${fullWorktreePath}" "${branchName}"`, {
          cwd: fullRepoPath,
          stdio: 'pipe',
          timeout: 30000,
        });
      } catch (err) {
        console.error(
          chalk.red(
            `Failed to create worktree: ${err instanceof Error ? err.message : 'Unknown error'}`
          )
        );
        process.exit(1);
      }
    }

    // Fetch requirement context
    const requirements = await getPendingRequirements(db.provider);
    const requirementContext =
      requirements.length > 0
        ? requirements
            .map(r => `- [${r.id}] ${r.title}: ${r.description || '(no description)'}`)
            .join('\n')
        : 'No active requirements found.';

    // Build initial prompt
    const prompt = buildChatAgentPrompt(sessionName, requirementContext);

    // Build CLI command
    const mcpConfig = getParentMcpConfig(root);
    const runtimeBuilder = getCliRuntimeBuilder(cliTool);
    const commandArgs = runtimeBuilder.buildSpawnCommand(
      modelConfig.model,
      modelConfig.safety_mode || 'unsafe',
      { ...(mcpConfig ? { mcpConfig } : {}) }
    );

    // Spawn tmux session
    await spawnTmuxSession({
      sessionName,
      workDir: fullWorktreePath,
      commandArgs,
      initialPrompt: prompt,
    });

    // Update agent record with session info
    const { updateAgent } = await import('../../db/queries/agents.js');
    await updateAgent(db.provider, agent.id, {
      tmuxSession: sessionName,
      status: 'working',
      worktreePath,
    });
    db.save();

    console.log(chalk.green(`Chat agent spawned successfully!`));
    console.log(chalk.cyan(`  Agent ID:     ${agent.id}`));
    console.log(chalk.cyan(`  Session:      ${sessionName}`));
    console.log(chalk.cyan(`  Worktree:     ${fullWorktreePath}`));
    console.log();
    console.log(chalk.gray(`Send messages with:`));
    console.log(chalk.white(`  hive message --agent ${agent.id} "your message"`));
    console.log();
    console.log(chalk.gray(`Attach to session:`));
    console.log(chalk.white(`  tmux attach -t ${sessionName}`));
  });
}

function buildChatAgentPrompt(sessionName: string, requirementContext: string): string {
  return `You are an interactive chat assistant for a Hive development workspace.

## Your Session
- Session name: ${sessionName}

## Current Requirements
${requirementContext}

## Capabilities
You are a helpful assistant that can:
- Inspect other tmux sessions: \`tmux capture-pane -t <session> -p\`
- Read hive logs and status: \`hive status\`, \`hive stories\`
- Check agent states: \`hive agents\`
- Check story progress: \`hive my-stories <session>\`
- View messages: \`hive msg inbox\`, \`hive msg outbox\`
- Explore the codebase and answer questions about it
- Help debug issues with agents or the development workflow

## Guidelines
- Be concise and helpful
- When inspecting other agents' sessions, provide relevant context
- If asked to perform actions, confirm before making changes
- You have access to the full codebase through your worktree`;
}

async function resolveAgent(
  provider: import('../../db/provider.js').DatabaseProvider,
  agentIdOrPartial: string
): Promise<AgentRow | undefined> {
  // Try exact match first
  const exact = await getAgentById(provider, agentIdOrPartial);
  if (exact) return exact;

  // Try partial match against all agents
  const allAgents = await getAllAgents(provider);
  const matches = allAgents.filter(
    a => a.id.includes(agentIdOrPartial) || a.tmux_session?.includes(agentIdOrPartial)
  );

  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    console.error(chalk.red(`Multiple agents match '${agentIdOrPartial}':`));
    for (const m of matches) {
      console.error(chalk.gray(`  - ${m.id} (${m.tmux_session || 'no session'})`));
    }
    return undefined;
  }

  return undefined;
}
