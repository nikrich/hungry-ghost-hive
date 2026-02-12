// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { join } from 'path';
import { TokenStore } from '../../auth/token-store.js';
import { loadConfig } from '../../config/loader.js';
import { queryOne } from '../../db/client.js';
import type { StoryRow } from '../../db/queries/stories.js';
import { JiraClient } from '../../integrations/jira/client.js';
import { postProgressToSubtask, transitionSubtask } from '../../integrations/jira/comments.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const progressCommand = new Command('progress')
  .description('Post a progress update to the Jira subtask for a story')
  .argument('<story-id>', 'Story ID to update')
  .requiredOption('-m, --message <text>', 'Progress update message')
  .option('--from <session>', 'Agent tmux session name')
  .option('--done', 'Also transition the subtask to Done')
  .action(async (storyId: string, options: { message: string; from?: string; done?: boolean }) => {
    await withHiveContext(async ({ db, paths }) => {
      const story = queryOne<StoryRow>(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);

      if (!story) {
        console.error(chalk.red(`Story not found: ${storyId}`));
        process.exit(1);
      }

      if (!story.jira_subtask_key) {
        console.error(chalk.red(`Story ${storyId} has no Jira subtask.`));
        console.log(chalk.gray('Jira subtask is created when a story is assigned to an agent.'));
        process.exit(1);
      }

      // Resolve agent name from session if provided
      let agentName = options.from;
      if (options.from) {
        const agent = queryOne<{ id: string; tmux_session: string }>(
          db.db,
          "SELECT id, tmux_session FROM agents WHERE tmux_session = ? AND status != 'terminated'",
          [options.from]
        );
        if (agent) {
          agentName = agent.tmux_session;
        }
      }

      const config = loadConfig(paths.hiveDir);
      await postProgressToSubtask(
        db.db,
        paths.hiveDir,
        config,
        storyId,
        options.message,
        agentName
      );

      console.log(chalk.green(`Posted progress update to subtask ${story.jira_subtask_key}`));

      // Optionally transition to Done
      if (options.done) {
        const pmConfig = config.integrations?.project_management;
        if (pmConfig?.provider === 'jira' && pmConfig.jira) {
          const tokenStore = new TokenStore(join(paths.hiveDir, '.env'));
          await tokenStore.loadFromEnv();
          const jiraClient = new JiraClient({
            tokenStore,
            clientId: process.env.JIRA_CLIENT_ID || '',
            clientSecret: process.env.JIRA_CLIENT_SECRET || '',
          });
          const transitioned = await transitionSubtask(jiraClient, story.jira_subtask_key, 'Done');
          if (transitioned) {
            console.log(chalk.green(`Transitioned subtask ${story.jira_subtask_key} to Done`));
          } else {
            console.log(
              chalk.yellow(`Could not transition subtask to Done (may already be done).`)
            );
          }
        }
      }
    });
  });
