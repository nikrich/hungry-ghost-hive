// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { pmCommand } from './pm.js';

/**
 * Print deprecation warning for jira command.
 */
function printDeprecationWarning(): void {
  console.log(
    chalk.yellow(
      '⚠️  The "hive jira" command is deprecated and will be removed in a future version.'
    )
  );
  console.log(chalk.yellow('   Please use "hive pm" instead for provider-agnostic PM operations.'));
  console.log('');
}

/**
 * Deprecated jira command that delegates to the new pm command.
 * Kept for backward compatibility.
 */
export const jiraCommand = new Command('jira')
  .description('Interact with Jira (deprecated - use "hive pm" instead)')
  .hook('preAction', () => {
    printDeprecationWarning();
  });

// Clone pm commands as jira subcommands
for (const subcommand of pmCommand.commands) {
  jiraCommand.addCommand(subcommand);
}
