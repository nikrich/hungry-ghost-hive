// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import {
  postProgressUpdate,
  transitionSubtaskStatus,
} from '../../connectors/project-management/operations.js';
import { queryOne } from '../../db/client.js';
import { createLog } from '../../db/queries/logs.js';
import type { StoryRow } from '../../db/queries/stories.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const progressCommand = new Command('progress')
  .description('Post a progress update to the configured project management provider')
  .argument('<story-id>', 'Story ID to update')
  .requiredOption('-m, --message <text>', 'Progress update message')
  .option('--from <session>', 'Agent tmux session name')
  .option('--done', 'Also transition the subtask to Done')
  .action(async (storyId: string, options: { message: string; from?: string; done?: boolean }) => {
    await withHiveContext(async ({ root, db, paths }) => {
      const config = loadConfig(paths.hiveDir);
      const pmProvider = config.integrations?.project_management?.provider || 'none';

      if (pmProvider === 'none') {
        createLog(db.db, {
          agentId: options.from || 'manager',
          storyId,
          eventType: 'STORY_PROGRESS_UPDATE',
          status: options.done ? 'done' : 'in_progress',
          message: options.message,
          metadata: {
            provider: 'none',
            external_sync: false,
            done: !!options.done,
          },
        });

        console.log(
          chalk.yellow(
            'No project management provider configured; recorded progress locally only.'
          )
        );
        return;
      }

      const story = queryOne<StoryRow>(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);

      if (!story) {
        console.error(chalk.red(`Story not found: ${storyId}`));
        process.exit(1);
      }

      if (!story.external_subtask_key) {
        console.error(chalk.red(`Story ${storyId} has no external subtask for provider "${pmProvider}".`));
        console.log(
          chalk.gray('External subtasks are created after story assignment when PM sync is enabled.')
        );
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

      await postProgressUpdate(db.db, paths.hiveDir, config, storyId, options.message, agentName);

      console.log(chalk.green(`Posted progress update to subtask ${story.external_subtask_key}`));

      // Optionally transition to Done
      if (options.done) {
        const transitioned = await transitionSubtaskStatus(
          root,
          story.external_subtask_key,
          'Done'
        );
        if (transitioned) {
          console.log(chalk.green(`Transitioned subtask ${story.external_subtask_key} to Done`));
        } else {
          console.log(chalk.yellow(`Could not transition subtask to Done (may already be done).`));
        }
      }
    });
  });
