// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { syncStoryToProvider } from '../../connectors/project-management/operations.js';
import {
  createStory,
  getAllStories,
  getStoriesByStatus,
  getStoryById,
  getStoryDependencies,
  updateStory,
  type StoryStatus,
} from '../../db/queries/stories.js';
import { statusColor } from '../../utils/logger.js';
import { withHiveContext, withReadOnlyHiveContext } from '../../utils/with-hive-context.js';

export const storiesCommand = new Command('stories').description('Manage stories');

storiesCommand
  .command('list')
  .description('List all stories')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output as JSON')
  .action(async (options: { status?: string; json?: boolean }) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      let stories;
      if (options.status) {
        stories = getStoriesByStatus(db.db, options.status as StoryStatus);
      } else {
        stories = getAllStories(db.db);
      }

      if (options.json) {
        console.log(JSON.stringify(stories, null, 2));
        return;
      }

      if (stories.length === 0) {
        console.log(chalk.yellow('No stories found.'));
        return;
      }

      console.log(chalk.bold('\nStories:\n'));

      // Header
      console.log(
        chalk.gray(
          `${'ID'.padEnd(15)} ${'Title'.padEnd(40)} ${'Status'.padEnd(15)} ${'Points'.padEnd(8)} ${'Assigned'}`
        )
      );
      console.log(chalk.gray('─'.repeat(100)));

      for (const story of stories) {
        const title = story.title.length > 37 ? story.title.substring(0, 37) + '...' : story.title;
        const points = story.story_points?.toString() || '-';
        const assigned = story.assigned_agent_id || '-';

        console.log(
          `${chalk.cyan(story.id.padEnd(15))} ${title.padEnd(40)} ${statusColor(story.status).padEnd(15)} ${points.padEnd(8)} ${assigned}`
        );
      }
      console.log();
    });
  });

storiesCommand
  .command('create')
  .description('Create a new story (syncs to Jira when PM integration is enabled)')
  .requiredOption('-t, --title <title>', 'Story title')
  .requiredOption('-d, --description <description>', 'Story description')
  .option('-r, --requirement <requirementId>', 'Parent requirement ID')
  .option('--team <teamId>', 'Team ID')
  .option('-p, --points <points>', 'Story points', parseInt)
  .option('-c, --complexity <complexity>', 'Complexity score', parseInt)
  .option('--criteria <criteria...>', 'Acceptance criteria (space-separated)')
  .option('--json', 'Output as JSON')
  .action(
    async (options: {
      title: string;
      description: string;
      requirement?: string;
      team?: string;
      points?: number;
      complexity?: number;
      criteria?: string[];
      json?: boolean;
    }) => {
      await withHiveContext(async ({ root, db }) => {
        // Create local story
        const story = createStory(db.db, {
          requirementId: options.requirement || null,
          teamId: options.team || null,
          title: options.title,
          description: options.description,
          acceptanceCriteria: options.criteria || null,
        });

        // Update with optional fields
        if (options.points !== undefined || options.complexity !== undefined) {
          updateStory(db.db, story.id, {
            storyPoints: options.points ?? null,
            complexityScore: options.complexity ?? null,
            status: 'estimated',
          });
        }

        // Sync to PM provider if configured
        let externalKey: string | null = null;
        try {
          const updatedStory = getStoryById(db.db, story.id)!;
          const result = await syncStoryToProvider(root, db.db, updatedStory);

          if (result) {
            externalKey = result.key;
          }
        } catch (err) {
          // PM sync failure should not prevent local story creation
          console.warn(
            chalk.yellow(
              `Warning: PM sync failed: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }

        if (options.json) {
          const finalStory = getStoryById(db.db, story.id);
          console.log(JSON.stringify(finalStory, null, 2));
          return;
        }

        console.log(chalk.green(`\nStory created: ${chalk.bold(story.id)}`));
        console.log(chalk.gray(`  Title: ${options.title}`));
        if (externalKey) {
          console.log(chalk.gray(`  External:  ${externalKey}`));
        }
        console.log();
      });
    }
  );

storiesCommand
  .command('show <story-id>')
  .description('Show story details')
  .action(async (storyId: string) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      const story = getStoryById(db.db, storyId);
      if (!story) {
        console.error(chalk.red(`Story not found: ${storyId}`));
        process.exit(1);
      }

      const dependencies = getStoryDependencies(db.db, story.id);

      console.log(chalk.bold(`\nStory: ${story.id}\n`));
      console.log(chalk.bold('Title:'), story.title);
      console.log(chalk.bold('Status:'), statusColor(story.status));

      console.log(chalk.bold('\nDescription:'));
      console.log(chalk.gray(story.description));

      if (story.acceptance_criteria) {
        console.log(chalk.bold('\nAcceptance Criteria:'));
        try {
          const criteria = JSON.parse(story.acceptance_criteria) as string[];
          for (const c of criteria) {
            console.log(chalk.gray(`  • ${c}`));
          }
        } catch (_error) {
          console.log(chalk.gray(story.acceptance_criteria));
        }
      }

      console.log(chalk.bold('\nDetails:'));
      console.log(chalk.gray(`  Requirement:    ${story.requirement_id || '-'}`));
      console.log(chalk.gray(`  Team:           ${story.team_id || '-'}`));
      console.log(chalk.gray(`  Complexity:     ${story.complexity_score || '-'}`));
      console.log(chalk.gray(`  Story Points:   ${story.story_points || '-'}`));
      console.log(chalk.gray(`  Assigned Agent: ${story.assigned_agent_id || '-'}`));
      console.log(chalk.gray(`  Branch:         ${story.branch_name || '-'}`));
      console.log(chalk.gray(`  PR URL:         ${story.pr_url || '-'}`));
      console.log(chalk.gray(`  Created:        ${story.created_at}`));
      console.log(chalk.gray(`  Updated:        ${story.updated_at}`));

      if (dependencies.length > 0) {
        console.log(chalk.bold('\nDependencies:'));
        for (const dep of dependencies) {
          console.log(
            `  ${chalk.cyan(dep.id)} - ${dep.title.substring(0, 40)}... - ${statusColor(dep.status)}`
          );
        }
      }
      console.log();
    });
  });
