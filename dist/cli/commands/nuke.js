import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { queryOne, run } from '../../db/client.js';
async function confirm(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(`${message} (yes/no): `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
        });
    });
}
export const nukeCommand = new Command('nuke')
    .description('Delete data (use with caution)')
    .addCommand(new Command('stories')
    .description('Delete all stories')
    .option('--force', 'Skip confirmation')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        // Count stories
        const count = queryOne(db.db, 'SELECT COUNT(*) as count FROM stories');
        const storyCount = count?.count || 0;
        if (storyCount === 0) {
            console.log(chalk.yellow('No stories to delete.'));
            return;
        }
        console.log(chalk.yellow(`\nThis will delete ${storyCount} stories and their dependencies.`));
        console.log(chalk.red('This action cannot be undone.\n'));
        if (!options.force) {
            const confirmed = await confirm(chalk.bold('Are you sure you want to delete all stories?'));
            if (!confirmed) {
                console.log(chalk.gray('Aborted.'));
                return;
            }
        }
        // Delete in order to respect foreign keys
        run(db.db, 'DELETE FROM story_dependencies');
        run(db.db, 'DELETE FROM stories');
        db.save();
        console.log(chalk.green(`\nDeleted ${storyCount} stories.`));
    }
    finally {
        db.close();
    }
}))
    .addCommand(new Command('agents')
    .description('Delete all agents')
    .option('--force', 'Skip confirmation')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        const count = queryOne(db.db, 'SELECT COUNT(*) as count FROM agents');
        const agentCount = count?.count || 0;
        if (agentCount === 0) {
            console.log(chalk.yellow('No agents to delete.'));
            return;
        }
        console.log(chalk.yellow(`\nThis will delete ${agentCount} agents and their logs.`));
        console.log(chalk.red('This action cannot be undone.\n'));
        if (!options.force) {
            const confirmed = await confirm(chalk.bold('Are you sure you want to delete all agents?'));
            if (!confirmed) {
                console.log(chalk.gray('Aborted.'));
                return;
            }
        }
        run(db.db, 'DELETE FROM agent_logs');
        run(db.db, 'DELETE FROM escalations');
        run(db.db, 'DELETE FROM agents');
        db.save();
        console.log(chalk.green(`\nDeleted ${agentCount} agents.`));
    }
    finally {
        db.close();
    }
}))
    .addCommand(new Command('all')
    .description('Delete all data (stories, agents, requirements)')
    .option('--force', 'Skip confirmation')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    try {
        console.log(chalk.red('\nThis will delete ALL data:'));
        console.log(chalk.yellow('  - All stories and dependencies'));
        console.log(chalk.yellow('  - All agents and logs'));
        console.log(chalk.yellow('  - All requirements'));
        console.log(chalk.yellow('  - All escalations'));
        console.log(chalk.yellow('  - All pull requests'));
        console.log(chalk.red('\nThis action cannot be undone.\n'));
        if (!options.force) {
            const confirmed = await confirm(chalk.bold('Are you sure you want to delete ALL data?'));
            if (!confirmed) {
                console.log(chalk.gray('Aborted.'));
                return;
            }
        }
        // Delete in order to respect foreign keys
        run(db.db, 'DELETE FROM pull_requests');
        run(db.db, 'DELETE FROM escalations');
        run(db.db, 'DELETE FROM agent_logs');
        run(db.db, 'DELETE FROM story_dependencies');
        run(db.db, 'DELETE FROM stories');
        run(db.db, 'DELETE FROM agents');
        run(db.db, 'DELETE FROM requirements');
        db.save();
        console.log(chalk.green('\nAll data deleted.'));
    }
    finally {
        db.close();
    }
}));
//# sourceMappingURL=nuke.js.map