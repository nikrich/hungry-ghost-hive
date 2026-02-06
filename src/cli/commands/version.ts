import { Command } from 'commander';
import chalk from 'chalk';
import { getVersion } from '../../utils/version.js';

export const versionCommand = new Command('version')
  .description('Show Hive version and system information')
  .action(() => {
    const version = getVersion();
    const nodeVersion = process.version;
    const platform = process.platform;

    console.log();
    console.log(chalk.cyan(`Hive v${version}`));
    console.log(chalk.gray(`Node.js: ${nodeVersion}`));
    console.log(chalk.gray(`Platform: ${platform}`));
    console.log();
  });
