// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { postCommentOnIssue } from '../../connectors/project-management/operations.js';
import { queryOne } from '../../db/client.js';
import { createLog } from '../../db/queries/logs.js';
import type { StoryRow } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const approachCommand = new Command('approach')
  .description('Post an implementation approach comment to a story')
  .argument('<story-id>', 'Story ID to post approach for')
  .argument('<approach-text>', 'Implementation approach description')
  .option('-f, --from <session>', 'Agent session name')
  .action(async (storyId: string, approachText: string, options: { from?: string }) => {
    await withHiveContext(async ({ root, db }) => {
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
          external_issue_key: story.external_issue_key,
        },
      });
      db.save();

      console.log(chalk.green(`Approach logged for story ${storyId}`));

      // Post to PM provider if configured
      if (!story.external_issue_key) {
        console.log(chalk.gray('No external issue key on story, skipping PM provider comment'));
        return;
      }

      try {
        const success = await postCommentOnIssue(
          root,
          story.external_issue_key,
          'approach_posted',
          { agentName, approachText }
        );

        if (success) {
          console.log(
            chalk.green(`Approach comment posted to PM provider issue ${story.external_issue_key}`)
          );
        } else {
          console.log(chalk.yellow('Failed to post approach comment to PM provider'));
        }
      } catch (err) {
        logger.warn(
          `Failed to post approach to PM provider: ${err instanceof Error ? err.message : String(err)}`
        );
        console.log(
          chalk.yellow('Failed to post approach comment to PM provider (logged locally)')
        );
      }
    });
  });
