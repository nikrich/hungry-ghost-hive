// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../../db/client.js';
import { withHiveContext, withReadOnlyHiveContext } from '../../utils/with-hive-context.js';

interface MessageRow {
  id: string;
  from_session: string;
  to_session: string;
  subject: string | null;
  body: string;
  reply: string | null;
  status: 'pending' | 'read' | 'replied';
  created_at: string;
  replied_at: string | null;
}

export const msgCommand = new Command('msg').description('Inter-agent messaging');

msgCommand
  .command('send <to-session> <message>')
  .description('Send a message to another agent')
  .option('-s, --subject <subject>', 'Message subject')
  .option('-f, --from <session>', 'Your session name (defaults to hive-tech-lead)')
  .action(
    async (toSession: string, message: string, options: { subject?: string; from?: string }) => {
      await withHiveContext(async ({ db }) => {
        const id = `msg-${nanoid(8)}`;
        const fromSession = options.from || 'hive-tech-lead';

        run(
          db.db,
          `
        INSERT INTO messages (id, from_session, to_session, subject, body, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
      `,
          [id, fromSession, toSession, options.subject || null, message]
        );
        db.save();

        console.log(chalk.green(`Message sent: ${id}`));
        console.log(chalk.gray(`To: ${toSession}`));
        console.log(chalk.gray(`Subject: ${options.subject || '(none)'}`));
      });
    }
  );

msgCommand
  .command('inbox [session]')
  .description('Check inbox for messages')
  .option('--all', 'Show all messages including read')
  .action(async (session: string | undefined, options: { all?: boolean }) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      const targetSession = session || 'hive-tech-lead';

      let query = `
        SELECT * FROM messages
        WHERE to_session = ?
      `;
      if (!options.all) {
        query += ` AND status = 'pending'`;
      }
      query += ` ORDER BY created_at DESC`;

      const messages = queryAll<MessageRow>(db.db, query, [targetSession]);

      if (messages.length === 0) {
        console.log(chalk.gray(`No ${options.all ? '' : 'pending '}messages for ${targetSession}`));
        return;
      }

      console.log(chalk.bold(`\nInbox for ${targetSession} (${messages.length} messages):\n`));

      for (const msg of messages) {
        const statusIcon =
          msg.status === 'pending'
            ? chalk.yellow('●')
            : msg.status === 'replied'
              ? chalk.green('✓')
              : chalk.gray('○');
        const time = msg.created_at.substring(0, 16).replace('T', ' ');

        console.log(`${statusIcon} ${chalk.cyan(msg.id)} from ${chalk.bold(msg.from_session)}`);
        console.log(`  ${chalk.gray(time)} ${msg.subject || ''}`);
        console.log(`  ${msg.body.substring(0, 80)}${msg.body.length > 80 ? '...' : ''}`);
        if (msg.reply) {
          console.log(
            chalk.green(
              `  Reply: ${msg.reply.substring(0, 60)}${msg.reply.length > 60 ? '...' : ''}`
            )
          );
        }
        console.log();
      }
    });
  });

msgCommand
  .command('read <msg-id>')
  .description('Read a specific message')
  .action(async (msgId: string) => {
    await withHiveContext(async ({ db }) => {
      const msg = queryOne<MessageRow>(db.db, 'SELECT * FROM messages WHERE id = ?', [msgId]);

      if (!msg) {
        console.error(chalk.red(`Message not found: ${msgId}`));
        process.exit(1);
      }

      // Mark as read
      if (msg.status === 'pending') {
        run(db.db, `UPDATE messages SET status = 'read' WHERE id = ?`, [msgId]);
        db.save();
      }

      console.log(chalk.bold(`\nMessage: ${msg.id}\n`));
      console.log(`From:    ${chalk.cyan(msg.from_session)}`);
      console.log(`To:      ${msg.to_session}`);
      console.log(`Subject: ${msg.subject || '(none)'}`);
      console.log(`Time:    ${msg.created_at}`);
      console.log(`Status:  ${msg.status}`);
      console.log(chalk.gray('─'.repeat(50)));
      console.log(msg.body);

      if (msg.reply) {
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.green('Reply:'));
        console.log(msg.reply);
      }
      console.log();
    });
  });

msgCommand
  .command('reply <msg-id> <response>')
  .description('Reply to a message')
  .action(async (msgId: string, response: string) => {
    await withHiveContext(async ({ db }) => {
      const msg = queryOne<MessageRow>(db.db, 'SELECT * FROM messages WHERE id = ?', [msgId]);

      if (!msg) {
        console.error(chalk.red(`Message not found: ${msgId}`));
        process.exit(1);
      }

      run(
        db.db,
        `
        UPDATE messages
        SET reply = ?, status = 'replied', replied_at = datetime('now')
        WHERE id = ?
      `,
        [response, msgId]
      );
      db.save();

      console.log(chalk.green(`Reply sent to ${msg.from_session}`));
    });
  });

msgCommand
  .command('outbox [session]')
  .description('Check sent messages and their replies')
  .action(async (session: string | undefined) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      const fromSession = session || 'hive-tech-lead';

      const messages = queryAll<MessageRow>(
        db.db,
        `
        SELECT * FROM messages
        WHERE from_session = ?
        ORDER BY created_at DESC
      `,
        [fromSession]
      );

      if (messages.length === 0) {
        console.log(chalk.gray(`No sent messages from ${fromSession}`));
        return;
      }

      console.log(chalk.bold(`\nSent messages from ${fromSession} (${messages.length}):\n`));

      for (const msg of messages) {
        const statusIcon =
          msg.status === 'replied'
            ? chalk.green('✓ REPLIED')
            : msg.status === 'read'
              ? chalk.yellow('○ READ')
              : chalk.gray('● PENDING');

        console.log(`${chalk.cyan(msg.id)} → ${chalk.bold(msg.to_session)} ${statusIcon}`);
        console.log(`  ${msg.body.substring(0, 60)}${msg.body.length > 60 ? '...' : ''}`);
        if (msg.reply) {
          console.log(
            chalk.green(`  ↳ ${msg.reply.substring(0, 60)}${msg.reply.length > 60 ? '...' : ''}`)
          );
        }
        console.log();
      }
    });
  });
