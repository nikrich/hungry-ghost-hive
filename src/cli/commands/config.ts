import { Command } from 'commander';
import chalk from 'chalk';
import { stringify } from 'yaml';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { loadConfig, saveConfig, getConfigValue, setConfigValue, ConfigError } from '../../config/loader.js';

export const configCommand = new Command('config')
  .description('Manage Hive configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);

    try {
      const config = loadConfig(paths.hiveDir);

      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log(stringify(config, { indent: 2 }));
      }
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(chalk.red(err.message));
      } else {
        console.error(chalk.red('Failed to load configuration:'), err);
      }
      process.exit(1);
    }
  });

configCommand
  .command('get <path>')
  .description('Get a specific configuration value')
  .action((path: string) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);

    try {
      const config = loadConfig(paths.hiveDir);
      const value = getConfigValue(config, path);

      if (value === undefined) {
        console.error(chalk.yellow(`Configuration key not found: ${path}`));
        process.exit(1);
      }

      if (typeof value === 'object') {
        console.log(stringify(value, { indent: 2 }));
      } else {
        console.log(value);
      }
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(chalk.red(err.message));
      } else {
        console.error(chalk.red('Failed to get configuration:'), err);
      }
      process.exit(1);
    }
  });

configCommand
  .command('set <path> <value>')
  .description('Set a configuration value')
  .action((path: string, value: string) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);

    try {
      const config = loadConfig(paths.hiveDir);

      // Try to parse value as JSON, otherwise use as string
      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Check for boolean strings
        if (value.toLowerCase() === 'true') {
          parsedValue = true;
        } else if (value.toLowerCase() === 'false') {
          parsedValue = false;
        } else if (!isNaN(Number(value))) {
          parsedValue = Number(value);
        } else {
          parsedValue = value;
        }
      }

      const newConfig = setConfigValue(config, path, parsedValue);
      saveConfig(paths.hiveDir, newConfig);

      console.log(chalk.green(`Set ${chalk.bold(path)} = ${JSON.stringify(parsedValue)}`));
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(chalk.red(err.message));
      } else {
        console.error(chalk.red('Failed to set configuration:'), err);
      }
      process.exit(1);
    }
  });
