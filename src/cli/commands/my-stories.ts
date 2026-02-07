// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { queryAll, queryOne, run, type StoryRow } from '../../db/client.js';
import { createLog } from '../../db/queries/logs.js';
import { createStory, getStoryDependencies, updateStory } from '../../db/queries/stories.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const myStoriesCommand = new Command('my-stories')
  .description('View and manage stories assigned to an agent')
  .argument('[session]', 'Tmux session name (e.g., hive-senior-myteam)')
  .option('--all', 'Show all stories for the team, not just assigned')
  .action(async (session: string | undefined, options: { all?: boolean }) => {
    await withHiveContext(async ({ db }) => {
      if (!session) {
        // Show all in-progress stories
        const stories = queryAll<StoryRow & { tmux_session?: string }>(
          db.db,
          `
          SELECT s.*, a.tmux_session
          FROM stories s
          LEFT JOIN agents a ON s.assigned_agent_id = a.id
          WHERE s.status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed')
          ORDER BY s.status, s.created_at
        `
        );

        if (stories.length === 0) {
          console.log(chalk.gray('No active stories found.'));
          return;
        }

        console.log(chalk.bold('\nActive Stories:\n'));
        for (const story of stories) {
          printStory(story, story.tmux_session);
        }
        return;
      }

      // Find agent by tmux session
      const agent = queryOne<{ id: string; team_id: string }>(
        db.db,
        'SELECT id, team_id FROM agents WHERE tmux_session = ?',
        [session]
      );

      if (!agent) {
        console.error(chalk.red(`No agent found with session: ${session}`));
        console.log(chalk.gray('Available sessions:'));
        const agents = queryAll<{ tmux_session: string }>(
          db.db,
          'SELECT tmux_session FROM agents WHERE tmux_session IS NOT NULL'
        );
        for (const a of agents) {
          console.log(chalk.gray(`  - ${a.tmux_session}`));
        }
        process.exit(1);
      }

      let stories: StoryRow[];
      if (options.all && agent.team_id) {
        // Show all team stories
        stories = queryAll<StoryRow>(
          db.db,
          `
          SELECT * FROM stories
          WHERE team_id = ?
          ORDER BY
            CASE status
              WHEN 'in_progress' THEN 1
              WHEN 'planned' THEN 2
              WHEN 'review' THEN 3
              WHEN 'qa' THEN 4
              ELSE 5
            END,
            complexity_score DESC
        `,
          [agent.team_id]
        );
      } else {
        // Show only assigned active stories (exclude merged/terminal states)
        stories = queryAll<StoryRow>(
          db.db,
          `
          SELECT * FROM stories
          WHERE assigned_agent_id = ?
          AND status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')
          ORDER BY created_at
        `,
          [agent.id]
        );
      }

      if (stories.length === 0) {
        console.log(
          chalk.yellow(`No stories ${options.all ? 'for your team' : 'assigned to you'}.`)
        );
        if (!options.all) {
          console.log(chalk.gray('Use --all to see all team stories.'));
        }
        return;
      }

      console.log(chalk.bold(`\nStories for ${session}${options.all ? ' (all team)' : ''}:\n`));

      for (const story of stories) {
        printStory(story);
      }
    });
  });

myStoriesCommand
  .command('claim <story-id>')
  .description('Claim a story to work on')
  .requiredOption('-s, --session <session>', 'Your tmux session name')
  .action(async (storyId: string, options: { session: string }) => {
    await withHiveContext(async ({ db }) => {
      // Find agent by session
      const agent = queryOne<{ id: string }>(
        db.db,
        'SELECT id FROM agents WHERE tmux_session = ?',
        [options.session]
      );

      if (!agent) {
        console.error(chalk.red(`No agent found with session: ${options.session}`));
        process.exit(1);
      }

      // Check story exists and is available
      const story = queryOne<StoryRow>(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
      if (!story) {
        console.error(chalk.red(`Story not found: ${storyId}`));
        process.exit(1);
      }

      if (story.assigned_agent_id && story.assigned_agent_id !== agent.id) {
        console.error(chalk.red(`Story already assigned to another agent.`));
        process.exit(1);
      }

      // Check if all dependencies are resolved (merged)
      const dependencies = getStoryDependencies(db.db, storyId);
      const unresolvedDeps = dependencies.filter(dep => dep.status !== 'merged');
      if (unresolvedDeps.length > 0) {
        console.error(chalk.red(`Cannot claim story: unresolved dependencies`));
        console.log(chalk.yellow('\nBlocking stories:'));
        for (const dep of unresolvedDeps) {
          console.log(
            chalk.yellow(`  - [${dep.id}] ${dep.title} (status: ${dep.status.toUpperCase()})`)
          );
        }
        process.exit(1);
      }

      // Claim the story
      run(
        db.db,
        `
        UPDATE stories
        SET assigned_agent_id = ?, status = 'in_progress', updated_at = datetime('now')
        WHERE id = ?
      `,
        [agent.id, storyId]
      );
      db.save();

      console.log(chalk.green(`Claimed story: ${storyId}`));
      console.log(chalk.gray(`Title: ${story.title}`));
    });
  });

myStoriesCommand
  .command('complete <story-id>')
  .description('Mark a story as complete (ready for review)')
  .action(async (storyId: string) => {
    await withHiveContext(async ({ db }) => {
      const story = queryOne<StoryRow>(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
      if (!story) {
        console.error(chalk.red(`Story not found: ${storyId}`));
        process.exit(1);
      }

      run(
        db.db,
        `
        UPDATE stories
        SET status = 'review', updated_at = datetime('now')
        WHERE id = ?
      `,
        [storyId]
      );
      db.save();

      console.log(chalk.green(`Story ${storyId} marked as ready for review.`));
    });
  });

myStoriesCommand
  .command('refactor')
  .description('Create a refactor story discovered during implementation')
  .requiredOption('-s, --session <session>', 'Your tmux session name')
  .requiredOption('-t, --title <title>', 'Refactor story title')
  .requiredOption('-d, --description <description>', 'Refactor scope and rationale')
  .option('-p, --points <points>', 'Story points / complexity (1-13)', '2')
  .option('--status <status>', 'Initial status (estimated|planned)', 'planned')
  .option('-c, --criteria <criteria...>', 'Acceptance criteria (repeatable)')
  .action(
    async (options: {
      session: string;
      title: string;
      description: string;
      points: string;
      status?: string;
      criteria?: string[];
    }) => {
      const points = parseInt(options.points, 10);
      if (!Number.isInteger(points) || points < 1 || points > 13) {
        console.error(chalk.red('Points must be an integer between 1 and 13.'));
        process.exit(1);
      }

      const status =
        options.status === 'estimated'
          ? 'estimated'
          : options.status === 'planned'
            ? 'planned'
            : null;
      if (!status) {
        console.error(chalk.red('Status must be either "estimated" or "planned".'));
        process.exit(1);
      }

      await withHiveContext(async ({ db }) => {
        const agent = queryOne<{ id: string; team_id: string | null }>(
          db.db,
          'SELECT id, team_id FROM agents WHERE tmux_session = ?',
          [options.session]
        );

        if (!agent) {
          console.error(chalk.red(`No agent found with session: ${options.session}`));
          process.exit(1);
        }

        if (!agent.team_id) {
          console.error(
            chalk.red(
              'This agent is not attached to a team, so a team refactor story cannot be created.'
            )
          );
          process.exit(1);
        }

        const trimmedTitle = options.title.trim();
        const normalizedTitle = /^refactor\s*:/i.test(trimmedTitle)
          ? trimmedTitle
          : `Refactor: ${trimmedTitle}`;

        const story = createStory(db.db, {
          teamId: agent.team_id,
          title: normalizedTitle,
          description: options.description.trim(),
          acceptanceCriteria:
            options.criteria && options.criteria.length > 0 ? options.criteria : null,
        });

        const updatedStory = updateStory(db.db, story.id, {
          complexityScore: points,
          storyPoints: points,
          status,
        });

        createLog(db.db, {
          agentId: agent.id,
          storyId: story.id,
          eventType: 'STORY_CREATED',
          message: `Refactor story proposed: ${normalizedTitle}`,
          metadata: {
            source: 'engineer_discovery',
            session: options.session,
            points,
            status,
          },
        });

        db.save();

        console.log(chalk.green(`Created refactor story: ${story.id}`));
        console.log(chalk.gray(`Title: ${normalizedTitle}`));
        console.log(
          chalk.gray(
            `Status: ${(updatedStory?.status || status).toUpperCase()} | Points: ${points}`
          )
        );
        console.log(
          chalk.gray('Run `hive assign` to schedule work based on current capacity policy.')
        );
      });
    }
  );

function printStory(story: StoryRow, assignedSession?: string): void {
  console.log(chalk.cyan(`[${story.id}]`) + ` ${story.title}`);
  console.log(
    `  Status: ${story.status.toUpperCase()} | Complexity: ${story.complexity_score || '?'}`
  );
  if (assignedSession) {
    console.log(`  Assigned: ${assignedSession}`);
  }
  if (story.description) {
    const desc = story.description.substring(0, 100);
    console.log(chalk.gray(`  ${desc}${story.description.length > 100 ? '...' : ''}`));
  }
  console.log();
}
