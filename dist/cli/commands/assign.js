import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { loadConfig } from '../../config/loader.js';
import { Scheduler } from '../../orchestrator/scheduler.js';
import { startManager, isManagerRunning } from '../../tmux/manager.js';
export const assignCommand = new Command('assign')
    .description('Assign planned stories to agents (spawns Seniors as needed)')
    .option('--dry-run', 'Show what would be assigned without making changes')
    .action(async (options) => {
    const root = findHiveRoot();
    if (!root) {
        console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
        process.exit(1);
    }
    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);
    const spinner = ora('Assigning stories...').start();
    try {
        const config = loadConfig(paths.hiveDir);
        if (options.dryRun) {
            spinner.text = 'Previewing assignments...';
            const scheduler = new Scheduler(db.db, {
                scaling: config.scaling,
                models: config.models,
                rootDir: root,
            });
            const preview = await scheduler.previewAssignments();
            spinner.stop();
            console.log();
            console.log(chalk.cyan.bold('📋 Assignment Preview (Dry Run)'));
            console.log(chalk.gray('No changes will be made\n'));
            if (preview.assignments.length === 0) {
                console.log(chalk.gray('No stories to assign'));
            }
            else {
                console.log(chalk.cyan('Planned Assignments:'));
                for (const { story, agent, willSpawn, agentType } of preview.assignments) {
                    const spawnIndicator = willSpawn ? chalk.yellow(' [NEW]') : '';
                    const agentDisplay = agent.id.includes('preview')
                        ? chalk.yellow(`new ${agentType}${spawnIndicator}`)
                        : chalk.green(agent.id);
                    console.log(`  ${chalk.bold(story.id)}: ${story.title.substring(0, 40)}`);
                    console.log(`    → ${agentDisplay}`);
                }
            }
            if (preview.blocked.length > 0) {
                console.log();
                console.log(chalk.yellow('⏸️  Blocked (dependencies not satisfied):'));
                for (const blocked of preview.blocked) {
                    console.log(`  ${blocked}`);
                }
            }
            if (preview.newAgents.length > 0) {
                console.log();
                console.log(chalk.yellow('🚀 New Agents to Spawn:'));
                const agentCounts = new Map();
                for (const { type, team } of preview.newAgents) {
                    const key = `${team}/${type}`;
                    agentCounts.set(key, (agentCounts.get(key) || 0) + 1);
                }
                for (const [key, count] of agentCounts) {
                    console.log(`  ${count}x ${key}`);
                }
            }
            if (preview.errors.length > 0) {
                console.log();
                console.log(chalk.red('❌ Errors:'));
                for (const error of preview.errors) {
                    console.log(`  ${error}`);
                }
            }
            console.log();
            console.log(chalk.gray(`Summary: ${preview.assignments.length} stories would be assigned`));
            console.log();
            console.log(chalk.cyan('To apply assignments, run:'));
            console.log(chalk.bold('  hive assign'));
            console.log();
            return;
        }
        const scheduler = new Scheduler(db.db, {
            scaling: config.scaling,
            models: config.models,
            rootDir: root,
        });
        // Check scaling first (spawns additional seniors if needed)
        spinner.text = 'Checking team scaling...';
        await scheduler.checkScaling();
        // Check merge queue (spawns QA agents if needed)
        spinner.text = 'Checking merge queue...';
        await scheduler.checkMergeQueue();
        // Assign stories to agents
        spinner.text = 'Assigning stories to agents...';
        const result = await scheduler.assignStories();
        if (result.errors.length > 0) {
            spinner.warn(chalk.yellow(`Assigned ${result.assigned} stories with ${result.errors.length} errors`));
            for (const error of result.errors) {
                console.log(chalk.red(`  - ${error}`));
            }
        }
        else if (result.assigned === 0) {
            spinner.info(chalk.gray('No stories to assign'));
        }
        else {
            spinner.succeed(chalk.green(`Assigned ${result.assigned} stories`));
        }
        // Auto-start the manager if work was assigned and it's not running
        if (result.assigned > 0) {
            if (!await isManagerRunning()) {
                spinner.start('Starting manager daemon...');
                const started = await startManager(60);
                if (started) {
                    spinner.succeed(chalk.green('Manager daemon started (checking every 60s)'));
                }
                else {
                    spinner.info(chalk.gray('Manager daemon already running'));
                }
            }
        }
        console.log();
        console.log(chalk.gray('View agent status:'));
        console.log(chalk.cyan('  hive agents list --active'));
        console.log();
    }
    catch (err) {
        spinner.fail(chalk.red('Failed to assign stories'));
        console.error(err);
        process.exit(1);
    }
    finally {
        db.close();
    }
});
//# sourceMappingURL=assign.js.map