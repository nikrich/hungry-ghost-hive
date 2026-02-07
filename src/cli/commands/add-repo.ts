// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync } from 'fs';
import ora from 'ora';
import { join } from 'path';
import { createTeam, getTeamByName } from '../../db/queries/teams.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const addRepoCommand = new Command('add-repo')
  .description('Add a repository as a git submodule with team assignment')
  .requiredOption('--url <url>', 'Repository URL')
  .requiredOption('--team <name>', 'Team name')
  .option('--branch <branch>', 'Branch to track', 'main')
  .action(async (options: { url: string; team: string; branch: string }) => {
    await withHiveContext(async ({ root, paths, db }) => {
      const spinner = ora('Adding repository...').start();

      // Extract repo name from URL
      const repoName = options.url.split('/').pop()?.replace('.git', '') || 'repo';
      const repoPath = join(paths.reposDir, repoName);
      const relativeRepoPath = `repos/${repoName}`;

      try {
        // Check if team already exists
        const existingTeam = getTeamByName(db.db, options.team);
        if (existingTeam) {
          spinner.fail(chalk.red(`Team "${options.team}" already exists`));
          process.exit(1);
        }

        // Check if repo path already exists
        if (existsSync(repoPath)) {
          spinner.fail(chalk.red(`Repository path already exists: ${repoPath}`));
          process.exit(1);
        }

        // Add git submodule
        spinner.text = 'Adding git submodule...';
        try {
          await execa(
            'git',
            ['submodule', 'add', '-b', options.branch, options.url, relativeRepoPath],
            {
              cwd: root,
            }
          );
        } catch (gitErr: unknown) {
          // If submodule already exists, try to init/update instead
          const error = gitErr as { stderr?: string };
          if (error.stderr?.includes('already exists')) {
            spinner.text = 'Submodule exists, initializing...';
            await execa('git', ['submodule', 'init', relativeRepoPath], { cwd: root });
            await execa('git', ['submodule', 'update', relativeRepoPath], { cwd: root });
          } else {
            throw gitErr;
          }
        }

        // Create team in database
        spinner.text = 'Creating team...';
        const team = createTeam(db.db, {
          repoUrl: options.url,
          repoPath: relativeRepoPath,
          name: options.team,
        });

        spinner.succeed(chalk.green(`Repository added successfully!`));
        console.log();
        console.log(chalk.bold('Team created:'));
        console.log(chalk.gray(`  ID:   ${team.id}`));
        console.log(chalk.gray(`  Name: ${team.name}`));
        console.log(chalk.gray(`  Repo: ${team.repo_url}`));
        console.log(chalk.gray(`  Path: ${team.repo_path}`));
        console.log();
      } catch (err) {
        spinner.fail(chalk.red('Failed to add repository'));
        console.error(err);
        process.exit(1);
      }
    });
  });
