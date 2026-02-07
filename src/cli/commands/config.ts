// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { stringify } from 'yaml';
import {
  ConfigError,
  getConfigValue,
  loadConfig,
  saveConfig,
  setConfigValue,
} from '../../config/loader.js';
import { withHiveRoot } from '../../utils/with-hive-context.js';

export const configCommand = new Command('config').description('Manage Hive configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    withHiveRoot(({ paths }) => {
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
  });

configCommand
  .command('get <path>')
  .description('Get a specific configuration value')
  .action((path: string) => {
    withHiveRoot(({ paths }) => {
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
  });

configCommand
  .command('set <path> <value>')
  .description('Set a configuration value')
  .action((path: string, value: string) => {
    withHiveRoot(({ paths }) => {
      try {
        const config = loadConfig(paths.hiveDir);

        // Try to parse value as JSON, otherwise use as string
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch (_error) {
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
  });
