import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { getAllTeams, getTeamByName, deleteTeam } from '../../db/queries/teams.js';
import { getAgentsByTeam } from '../../db/queries/agents.js';
import { getStoriesByTeam, getStoryPointsByTeam } from '../../db/queries/stories.js';

export const teamsCommand = new Command('teams').description('Manage teams');

teamsCommand
  .command('list')
  .description('List all teams')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const teams = getAllTeams(db.db);

      if (options.json) {
        console.log(JSON.stringify(teams, null, 2));
        return;
      }

      if (teams.length === 0) {
        console.log(chalk.yellow('No teams found.'));
        console.log(chalk.gray('Use "hive add-repo --url <url> --team <name>" to add a team.'));
        return;
      }

      console.log(chalk.bold('\nTeams:\n'));

      for (const team of teams) {
        const agents = getAgentsByTeam(db.db, team.id);
        const stories = getStoriesByTeam(db.db, team.id);
        const storyPoints = getStoryPointsByTeam(db.db, team.id);

        console.log(chalk.cyan(`  ${team.name}`));
        console.log(chalk.gray(`    ID:           ${team.id}`));
        console.log(chalk.gray(`    Repository:   ${team.repo_url}`));
        console.log(chalk.gray(`    Path:         ${team.repo_path}`));
        console.log(chalk.gray(`    Agents:       ${agents.length}`));
        console.log(chalk.gray(`    Stories:      ${stories.length}`));
        console.log(chalk.gray(`    Story Points: ${storyPoints}`));
        console.log();
      }
    } finally {
      db.close();
    }
  });

teamsCommand
  .command('show <name>')
  .description('Show team details')
  .action(async (name: string) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const team = getTeamByName(db.db, name);

      if (!team) {
        console.error(chalk.red(`Team not found: ${name}`));
        process.exit(1);
      }

      const agents = getAgentsByTeam(db.db, team.id);
      const stories = getStoriesByTeam(db.db, team.id);
      const storyPoints = getStoryPointsByTeam(db.db, team.id);

      console.log(chalk.bold(`\nTeam: ${team.name}\n`));
      console.log(chalk.gray(`ID:           ${team.id}`));
      console.log(chalk.gray(`Repository:   ${team.repo_url}`));
      console.log(chalk.gray(`Path:         ${team.repo_path}`));
      console.log(chalk.gray(`Created:      ${team.created_at}`));
      console.log();

      if (agents.length > 0) {
        console.log(chalk.bold('Agents:'));
        for (const agent of agents) {
          const statusColor =
            agent.status === 'working'
              ? chalk.yellow
              : agent.status === 'idle'
                ? chalk.gray
                : chalk.red;
          console.log(`  ${chalk.cyan(agent.id)} - ${agent.type} - ${statusColor(agent.status)}`);
        }
        console.log();
      }

      if (stories.length > 0) {
        console.log(chalk.bold('Stories:'));
        for (const story of stories) {
          const statusColor =
            story.status === 'merged'
              ? chalk.green
              : story.status === 'in_progress'
                ? chalk.yellow
                : chalk.gray;
          console.log(
            `  ${chalk.cyan(story.id)} - ${story.title.substring(0, 40)}... - ${statusColor(story.status)}`
          );
        }
        console.log();
      }

      console.log(chalk.bold('Summary:'));
      console.log(`  Total Stories: ${stories.length}`);
      console.log(`  Active Story Points: ${storyPoints}`);
      console.log(`  Active Agents: ${agents.filter((a) => a.status !== 'terminated').length}`);
    } finally {
      db.close();
    }
  });

teamsCommand
  .command('remove <name>')
  .description('Remove a team')
  .option('--force', 'Force removal even if team has active stories')
  .action(async (name: string, options: { force?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const team = getTeamByName(db.db, name);

      if (!team) {
        console.error(chalk.red(`Team not found: ${name}`));
        process.exit(1);
      }

      const stories = getStoriesByTeam(db.db, team.id);
      const activeStories = stories.filter((s) => !['merged', 'draft'].includes(s.status));

      if (activeStories.length > 0 && !options.force) {
        console.error(
          chalk.red(
            `Team has ${activeStories.length} active stories. Use --force to remove anyway.`
          )
        );
        process.exit(1);
      }

      deleteTeam(db.db, team.id);
      console.log(chalk.green(`Team "${name}" removed successfully.`));
      console.log(
        chalk.yellow('Note: Git submodule was not removed. Run the following to remove it:')
      );
      console.log(chalk.gray(`  git submodule deinit -f ${team.repo_path}`));
      console.log(chalk.gray(`  git rm -f ${team.repo_path}`));
    } finally {
      db.close();
    }
  });
