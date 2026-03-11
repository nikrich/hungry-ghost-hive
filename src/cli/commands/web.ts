// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';

export const webCommand = new Command('web')
  .description('Open web dashboard in browser')
  .option('-p, --port <port>', 'Override port')
  .option('-H, --host <host>', 'Override host')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options: { port?: string; host?: string; open: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);
    const webConfig = { ...config.web };

    if (options.port) {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(chalk.red('Invalid port number'));
        process.exit(1);
      }
      webConfig.port = port;
    }
    if (options.host) {
      webConfig.host = options.host;
    }

    const { WebDashboardServer } = await import('../../web/index.js');
    const server = new WebDashboardServer(webConfig, paths.hiveDir, root);

    // Graceful shutdown
    const shutdown = async () => {
      console.log(chalk.gray('\nShutting down web dashboard...'));
      await server.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());

    try {
      await server.start();
      console.log(chalk.green(`Web dashboard running at ${chalk.bold(server.url)}`));
      console.log(chalk.gray('Press Ctrl+C to stop'));

      if (options.open) {
        const { openBrowser } = await import('../../utils/open-browser.js');
        await openBrowser(server.url);
      }
    } catch (err) {
      console.error(chalk.red('Failed to start web dashboard:'), err);
      process.exit(1);
    }
  });
