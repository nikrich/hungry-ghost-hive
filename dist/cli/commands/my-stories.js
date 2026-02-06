import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase, queryAll, queryOne, run } from '../../db/client.js';
export const myStoriesCommand = new Command('my-stories')
    .description('View and manage stories assigned to an agent')
    .argument('[session]', 'Tmux session name (e.g., hive-senior-myteam)')
    .option('--all', 'Show all stories for the team, not just assigned')
    .action(async (session, options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        if (!session) {
            // Show all in-progress stories
            const stories = queryAll(db.db, `
          SELECT s.*, a.tmux_session
          FROM stories s
          LEFT JOIN agents a ON s.assigned_agent_id = a.id
          WHERE s.status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed')
          ORDER BY s.status, s.created_at
        `);
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
        const agent = queryOne(db.db, 'SELECT id, team_id FROM agents WHERE tmux_session = ?', [session]);
        if (!agent) {
            console.error(chalk.red(`No agent found with session: ${session}`));
            console.log(chalk.gray('Available sessions:'));
            const agents = queryAll(db.db, 'SELECT tmux_session FROM agents WHERE tmux_session IS NOT NULL');
            for (const a of agents) {
                console.log(chalk.gray(`  - ${a.tmux_session}`));
            }
            process.exit(1);
        }
        let stories;
        if (options.all && agent.team_id) {
            // Show all team stories
            stories = queryAll(db.db, `
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
        `, [agent.team_id]);
        }
        else {
            // Show only assigned active stories (exclude merged/terminal states)
            stories = queryAll(db.db, `
          SELECT * FROM stories
          WHERE assigned_agent_id = ?
          AND status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')
          ORDER BY created_at
        `, [agent.id]);
        }
        if (stories.length === 0) {
            console.log(chalk.yellow(`No stories ${options.all ? 'for your team' : 'assigned to you'}.`));
            if (!options.all) {
                console.log(chalk.gray('Use --all to see all team stories.'));
            }
            return;
        }
        console.log(chalk.bold(`\nStories for ${session}${options.all ? ' (all team)' : ''}:\n`));
        for (const story of stories) {
            printStory(story);
        }
    }
    finally {
        db.close();
    }
});
myStoriesCommand
    .command('claim <story-id>')
    .description('Claim a story to work on')
    .requiredOption('-s, --session <session>', 'Your tmux session name')
    .action(async (storyId, options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        // Find agent by session
        const agent = queryOne(db.db, 'SELECT id FROM agents WHERE tmux_session = ?', [options.session]);
        if (!agent) {
            console.error(chalk.red(`No agent found with session: ${options.session}`));
            process.exit(1);
        }
        // Check story exists and is available
        const story = queryOne(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
        if (!story) {
            console.error(chalk.red(`Story not found: ${storyId}`));
            process.exit(1);
        }
        if (story.assigned_agent_id && story.assigned_agent_id !== agent.id) {
            console.error(chalk.red(`Story already assigned to another agent.`));
            process.exit(1);
        }
        // Claim the story
        run(db.db, `
        UPDATE stories
        SET assigned_agent_id = ?, status = 'in_progress', updated_at = datetime('now')
        WHERE id = ?
      `, [agent.id, storyId]);
        db.save();
        console.log(chalk.green(`Claimed story: ${storyId}`));
        console.log(chalk.gray(`Title: ${story.title}`));
    }
    finally {
        db.close();
    }
});
myStoriesCommand
    .command('complete <story-id>')
    .description('Mark a story as complete (ready for review)')
    .action(async (storyId) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        const story = queryOne(db.db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
        if (!story) {
            console.error(chalk.red(`Story not found: ${storyId}`));
            process.exit(1);
        }
        run(db.db, `
        UPDATE stories
        SET status = 'review', updated_at = datetime('now')
        WHERE id = ?
      `, [storyId]);
        db.save();
        console.log(chalk.green(`Story ${storyId} marked as ready for review.`));
    }
    finally {
        db.close();
    }
});
function printStory(story, assignedSession) {
    console.log(chalk.cyan(`[${story.id}]`) + ` ${story.title}`);
    console.log(`  Status: ${story.status.toUpperCase()} | Complexity: ${story.complexity_score || '?'}`);
    if (assignedSession) {
        console.log(`  Assigned: ${assignedSession}`);
    }
    if (story.description) {
        const desc = story.description.substring(0, 100);
        console.log(chalk.gray(`  ${desc}${story.description.length > 100 ? '...' : ''}`));
    }
    console.log();
}
//# sourceMappingURL=my-stories.js.map