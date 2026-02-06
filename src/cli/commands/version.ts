import { Command } from 'commander';
import chalk from 'chalk';
import { getVersion } from '../../utils/version.js';

export const versionCommand = new Command('version')
  .description('Show Hive version')
  .action(() => {
    const version = getVersion();
    console.log(chalk.cyan(`Hive v${version}`));
  });
