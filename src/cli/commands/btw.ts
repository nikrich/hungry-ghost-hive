// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { nanoid } from 'nanoid';
import { getTechLeadSessionName } from '../../utils/instance.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const btwCommand = new Command('btw')
  .description('Send a non-interrupting nudge to an agent (delivered only at natural breakpoints)')
  .argument('<to-session>', 'Target agent session name')
  .argument('<message>', 'Message content')
  .option('-f, --from <session>', 'Your session name (defaults to tech lead session)')
  .action(async (toSession: string, message: string, options: { from?: string }) => {
    await withHiveContext(async ({ db, paths }) => {
      const id = `btw-${nanoid(8)}`;
      const fromSession = options.from || getTechLeadSessionName(paths.hiveDir);

      const now = new Date().toISOString();
      await db.provider.run(
        `INSERT INTO messages (id, from_session, to_session, subject, body, status, priority, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 'low', ?)`,
        [id, fromSession, toSession, null, message, now]
      );
      db.save();

      console.log(chalk.green(`BTW message queued: ${id}`));
      console.log(chalk.gray(`To: ${toSession}`));
      console.log(chalk.gray(`Message will be delivered when agent reaches a natural breakpoint.`));
    });
  });
