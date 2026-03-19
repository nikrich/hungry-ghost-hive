// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { AgentRow, PullRequestRow, StoryRow } from '../db/client.js';
import type { DatabaseProvider } from '../db/provider.js';
import { getAgentById } from '../db/queries/agents.js';
import { getPullRequestById } from '../db/queries/pull-requests.js';
import { getStoryById } from '../db/queries/stories.js';
import { normalizeStoryId } from './story-id.js';

/**
 * Require a story by ID, exit with error if not found.
 */
export async function requireStory(db: DatabaseProvider, storyId: string): Promise<StoryRow> {
  const story = await getStoryById(db, normalizeStoryId(storyId));
  if (!story) {
    console.error(chalk.red(`Story not found: ${storyId}`));
    process.exit(1);
  }
  return story;
}

/**
 * Require an agent by ID, exit with error if not found.
 */
export async function requireAgent(db: DatabaseProvider, agentId: string): Promise<AgentRow> {
  const agent = await getAgentById(db, agentId);
  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentId}`));
    process.exit(1);
  }
  return agent;
}

/**
 * Require an active agent by tmux session name, exit with error if not found or terminated.
 */
export async function requireAgentBySession(
  db: DatabaseProvider,
  session: string
): Promise<AgentRow> {
  const agent = await db.queryOne<AgentRow>(
    "SELECT * FROM agents WHERE tmux_session = ? AND status != 'terminated'",
    [session]
  );
  if (!agent) {
    console.error(chalk.red(`No agent found with session: ${session}`));
    process.exit(1);
  }
  return agent;
}

/**
 * Require a pull request by ID, exit with error if not found.
 */
export async function requirePullRequest(
  db: DatabaseProvider,
  prId: string
): Promise<PullRequestRow> {
  const pr = await getPullRequestById(db, prId);
  if (!pr) {
    console.error(chalk.red(`PR not found: ${prId}`));
    process.exit(1);
  }
  return pr;
}
