// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { nanoid } from 'nanoid';
import { getAgentById, getAllAgents, type AgentRow } from '../../db/queries/agents.js';
import { sendMessageWithConfirmation, isTmuxSessionRunning } from '../../tmux/manager.js';
import { getTechLeadSessionName } from '../../utils/instance.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const messageCommand = new Command('message').description(
  'Send messages directly to agent tmux sessions'
);

messageCommand
  .argument('<text>', 'Message text to send to the agent')
  .requiredOption('-a, --agent <agentId>', 'Agent ID (or partial match)')
  .option('-f, --from <session>', 'Your session name (defaults to tech lead session)')
  .action(async (text: string, options: { agent: string; from?: string }) => {
    await withHiveContext(async ({ db, paths }) => {
      const fromSession = options.from || getTechLeadSessionName(paths.hiveDir);

      // Look up agent by exact ID or partial match
      const agent = await resolveAgent(db.provider, options.agent);

      if (!agent) {
        console.error(chalk.red(`No agent found matching: ${options.agent}`));
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
  });

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
