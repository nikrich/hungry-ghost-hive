import { Command } from 'commander';
import chalk from 'chalk';
import { findHiveRoot, getHivePaths } from '../../utils/paths.js';
import { getDatabase } from '../../db/client.js';
import { getAllEscalations, getPendingEscalations, getEscalationById, resolveEscalation, acknowledgeEscalation } from '../../db/queries/escalations.js';
import { createLog } from '../../db/queries/logs.js';

export const escalationsCommand = new Command('escalations')
  .description('Manage escalations');

escalationsCommand
  .command('list')
  .description('List escalations')
  .option('--all', 'Show all escalations (including resolved)')
  .option('--json', 'Output as JSON')
  .action(async (options: { all?: boolean; json?: boolean }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const escalations = options.all ? getAllEscalations(db.db) : getPendingEscalations(db.db);

      if (options.json) {
        console.log(JSON.stringify(escalations, null, 2));
        return;
      }

      if (escalations.length === 0) {
        console.log(chalk.green('No pending escalations.'));
        return;
      }

      console.log(chalk.bold('\nEscalations:\n'));

      for (const esc of escalations) {
        const statusIcon = esc.status === 'pending' ? chalk.yellow('⚠') : esc.status === 'acknowledged' ? chalk.blue('◉') : chalk.green('✓');
        const toAgent = esc.to_agent_id || chalk.red('HUMAN');

        console.log(`${statusIcon} ${chalk.cyan(esc.id)}`);
        console.log(chalk.gray(`   Story:    ${esc.story_id || '-'}`));
        console.log(chalk.gray(`   From:     ${esc.from_agent_id || '-'}`));
        console.log(chalk.gray(`   To:       ${toAgent}`));
        console.log(chalk.gray(`   Reason:   ${esc.reason}`));
        console.log(chalk.gray(`   Status:   ${esc.status}`));
        if (esc.resolution) {
          console.log(chalk.gray(`   Resolution: ${esc.resolution}`));
        }
        console.log(chalk.gray(`   Created:  ${esc.created_at}`));
        console.log();
      }
    } finally {
      db.close();
    }
  });

escalationsCommand
  .command('show <id>')
  .description('Show escalation details')
  .action(async (id: string) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const escalation = getEscalationById(db.db, id);
      if (!escalation) {
        console.error(chalk.red(`Escalation not found: ${id}`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nEscalation: ${escalation.id}\n`));
      console.log(chalk.bold('Story:'), escalation.story_id || '-');
      console.log(chalk.bold('From Agent:'), escalation.from_agent_id || '-');
      console.log(chalk.bold('To Agent:'), escalation.to_agent_id || chalk.red('HUMAN'));
      console.log(chalk.bold('Status:'), escalation.status);
      console.log(chalk.bold('Created:'), escalation.created_at);

      console.log(chalk.bold('\nReason:'));
      console.log(chalk.gray(escalation.reason));

      if (escalation.resolution) {
        console.log(chalk.bold('\nResolution:'));
        console.log(chalk.gray(escalation.resolution));
        console.log(chalk.bold('Resolved At:'), escalation.resolved_at);
      }
      console.log();
    } finally {
      db.close();
    }
  });

escalationsCommand
  .command('resolve <id>')
  .description('Resolve an escalation')
  .requiredOption('-m, --message <message>', 'Resolution message/guidance')
  .action(async (id: string, options: { message: string }) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const escalation = getEscalationById(db.db, id);
      if (!escalation) {
        console.error(chalk.red(`Escalation not found: ${id}`));
        process.exit(1);
      }

      if (escalation.status === 'resolved') {
        console.log(chalk.yellow('Escalation is already resolved.'));
        return;
      }

      const resolved = resolveEscalation(db.db, id, options.message);

      // Log the resolution
      if (escalation.from_agent_id) {
        createLog(db.db, {
          agentId: escalation.from_agent_id,
          storyId: escalation.story_id,
          eventType: 'ESCALATION_RESOLVED',
          message: options.message,
          metadata: { escalation_id: id },
        });
      }

      console.log(chalk.green(`Escalation ${id} resolved successfully.`));
      console.log(chalk.gray(`Resolution: ${resolved?.resolution}`));
    } finally {
      db.close();
    }
  });

escalationsCommand
  .command('acknowledge <id>')
  .description('Acknowledge an escalation (mark as being worked on)')
  .action(async (id: string) => {
    const root = findHiveRoot();
    if (!root) {
      console.error(chalk.red('Not in a Hive workspace. Run "hive init" first.'));
      process.exit(1);
    }

    const paths = getHivePaths(root);
    const db = await getDatabase(paths.hiveDir);

    try {
      const escalation = getEscalationById(db.db, id);
      if (!escalation) {
        console.error(chalk.red(`Escalation not found: ${id}`));
        process.exit(1);
      }

      if (escalation.status !== 'pending') {
        console.log(chalk.yellow(`Escalation is already ${escalation.status}.`));
        return;
      }

      acknowledgeEscalation(db.db, id);
      console.log(chalk.green(`Escalation ${id} acknowledged.`));
    } finally {
      db.close();
    }
  });
