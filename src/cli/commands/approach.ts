// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { join } from 'path';
import { TokenStore } from '../../auth/token-store.js';
import { loadConfig } from '../../config/loader.js';
import { queryOne } from '../../db/client.js';
import { createLog } from '../../db/queries/logs.js';
import type { StoryRow } from '../../db/queries/stories.js';
import { JiraClient } from '../../integrations/jira/client.js';
import { postComment } from '../../integrations/jira/comments.js';
import * as logger from '../../utils/logger.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const approachCommand = new Command('approach')
  .description('Post an implementation approach comment to a Jira story')
  .argument('<story-id>', 'Story ID to post approach for')
  .argument('<approach-text>', 'Implementation approach description')
  .option('-f, --from <session>', 'Agent session name')
  .action(
    async (storyId: string, approachText: string, options: { from?: string }) => {
      await withHiveContext(async ({ paths, db }) => {
        const agentName = options.from || 'unknown-agent';

        // Look up the story
        const story = queryOne<StoryRow>(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
        if (!story) {
          console.error(chalk.red(`Story not found: ${storyId}`));
          process.exit(1);
        }

        // Log approach to agent_logs
        createLog(db.db, {
          agentId: agentName,
          storyId,
          eventType: 'APPROACH_POSTED',
          message: approachText,
          metadata: {
            jira_issue_key: story.jira_issue_key,
          },
        });
        db.save();

        console.log(chalk.green(`Approach logged for story ${storyId}`));

        // Post to Jira if configured
        if (!story.jira_issue_key) {
          console.log(chalk.gray('No Jira issue key on story, skipping Jira comment'));
          return;
        }

        try {
          const config = loadConfig(paths.hiveDir);
          const pmConfig = config.integrations?.project_management;
          if (!pmConfig || pmConfig.provider !== 'jira' || !pmConfig.jira) {
            console.log(chalk.gray('Jira integration not configured, skipping Jira comment'));
            return;
          }

          const tokenStore = new TokenStore(join(paths.hiveDir, '.env'));
          await tokenStore.loadFromEnv();

          const jiraClient = new JiraClient({
            tokenStore,
            clientId: process.env.JIRA_CLIENT_ID || '',
            clientSecret: process.env.JIRA_CLIENT_SECRET || '',
          });

          const success = await postComment(jiraClient, story.jira_issue_key, 'approach_posted', {
            agentName,
            approachText,
          });

          if (success) {
            console.log(
              chalk.green(`Approach comment posted to Jira issue ${story.jira_issue_key}`)
            );
          } else {
            console.log(chalk.yellow('Failed to post approach comment to Jira'));
          }
        } catch (err) {
          logger.warn(
            `Failed to post approach to Jira: ${err instanceof Error ? err.message : String(err)}`
          );
          console.log(chalk.yellow('Failed to post approach comment to Jira (logged locally)'));
        }
      });
    }
  );
