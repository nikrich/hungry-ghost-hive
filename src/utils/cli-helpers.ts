// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import type { Database } from 'sql.js';
import type { AgentRow, PullRequestRow, StoryRow } from '../db/client.js';
import { queryOne } from '../db/client.js';
import { getAgentById } from '../db/queries/agents.js';
import { getPullRequestById } from '../db/queries/pull-requests.js';
import { getStoryById } from '../db/queries/stories.js';
import { normalizeStoryId } from './story-id.js';

/**
 * Require a story by ID, exit with error if not found.
 */
export function requireStory(db: Database, storyId: string): StoryRow {
  const story = getStoryById(db, normalizeStoryId(storyId));
  if (!story) {
    console.error(chalk.red(`Story not found: ${storyId}`));
    process.exit(1);
  }
  return story;
}

/**
 * Require an agent by ID, exit with error if not found.
 */
export function requireAgent(db: Database, agentId: string): AgentRow {
  const agent = getAgentById(db, agentId);
  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentId}`));
    process.exit(1);
  }
  return agent;
}

/**
 * Require an active agent by tmux session name, exit with error if not found or terminated.
 */
export function requireAgentBySession(db: Database, session: string): AgentRow {
  const agent = queryOne<AgentRow>(
    db,
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
export function requirePullRequest(db: Database, prId: string): PullRequestRow {
  const pr = getPullRequestById(db, prId);
  if (!pr) {
    console.error(chalk.red(`PR not found: ${prId}`));
    process.exit(1);
  }
  return pr;
}
