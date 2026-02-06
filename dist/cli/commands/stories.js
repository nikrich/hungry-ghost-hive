import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { getAllStories, getStoryById, getStoriesByStatus, getStoryDependencies } from '../../db/queries/stories.js';
import { statusColor } from '../../utils/logger.js';
export const storiesCommand = new Command('stories')
    .description('Manage stories');
storiesCommand
    .command('list')
    .description('List all stories')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        let stories;
        if (options.status) {
            stories = getStoriesByStatus(db.db, options.status);
        }
        else {
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
        console.log(chalk.gray(`${'ID'.padEnd(15)} ${'Title'.padEnd(40)} ${'Status'.padEnd(15)} ${'Points'.padEnd(8)} ${'Assigned'}`));
        console.log(chalk.gray('─'.repeat(100)));
        for (const story of stories) {
            const title = story.title.length > 37 ? story.title.substring(0, 37) + '...' : story.title;
            const points = story.story_points?.toString() || '-';
            const assigned = story.assigned_agent_id || '-';
            console.log(`${chalk.cyan(story.id.padEnd(15))} ${title.padEnd(40)} ${statusColor(story.status).padEnd(15)} ${points.padEnd(8)} ${assigned}`);
        }
        console.log();
    }
    finally {
        db.close();
    }
});
storiesCommand
    .command('show <story-id>')
    .description('Show story details')
    .action(async (storyId) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
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
                const criteria = JSON.parse(story.acceptance_criteria);
                for (const c of criteria) {
                    console.log(chalk.gray(`  • ${c}`));
                }
            }
            catch {
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
                console.log(`  ${chalk.cyan(dep.id)} - ${dep.title.substring(0, 40)}... - ${statusColor(dep.status)}`);
            }
        }
        console.log();
    }
    finally {
        db.close();
    }
});
//# sourceMappingURL=stories.js.map