// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import {
  getAllEscalations,
  getEscalationById,
  getPendingHumanEscalations,
  resolveEscalation,
  type EscalationRow,
} from '../../db/queries/escalations.js';
import { withHiveContext } from '../../utils/with-hive-context.js';

export const approvalsCommand = new Command('approvals').description(
  'Manage human approval requests'
);

function classifyApproval(
  reason: string
): 'permission' | 'plan' | 'question' | 'selection' | 'other' {
  const normalized = reason.toLowerCase();
  if (
    normalized.includes('permission') ||
    normalized.includes('authorize') ||
    normalized.includes('approve')
  ) {
    return 'permission';
  }
  if (normalized.includes('plan')) return 'plan';
  if (normalized.includes('selection') || normalized.includes('select')) return 'selection';
  if (
    normalized.includes('question') ||
    normalized.includes('input') ||
    normalized.includes('clarification')
  ) {
    return 'question';
  }
  return 'other';
}

function ensureHumanApprovalEscalation(
  escalation: EscalationRow | undefined,
  id: string
): EscalationRow {
  if (!escalation) {
    console.error(chalk.red(`Approval request not found: ${id}`));
    process.exit(1);
  }

  if (escalation.to_agent_id !== null) {
    console.error(chalk.red(`Escalation ${id} is not a human approval request.`));
    process.exit(1);
  }

  return escalation;
}

approvalsCommand
  .command('list')
  .description('List human approval requests')
  .option('--all', 'Show all human approval requests (including resolved)')
  .option('--json', 'Output as JSON')
  .action(async (options: { all?: boolean; json?: boolean }) => {
    await withHiveContext(async ({ db }) => {
      const approvals = options.all
        ? getAllEscalations(db.db).filter(escalation => escalation.to_agent_id === null)
        : getPendingHumanEscalations(db.db);

      if (options.json) {
        console.log(JSON.stringify(approvals, null, 2));
        return;
      }

      if (approvals.length === 0) {
        console.log(chalk.green('No pending human approvals.'));
        return;
      }

      console.log(chalk.bold('\nHuman Approvals:\n'));
      for (const approval of approvals) {
        const type = classifyApproval(approval.reason);
        const statusIcon =
          approval.status === 'pending'
            ? chalk.yellow('⚠')
            : approval.status === 'acknowledged'
              ? chalk.blue('◉')
              : chalk.green('✓');
        console.log(`${statusIcon} ${chalk.cyan(approval.id)}  [${type}]`);
        console.log(chalk.gray(`   Agent:   ${approval.from_agent_id || '-'}`));
        console.log(chalk.gray(`   Story:   ${approval.story_id || '-'}`));
        console.log(chalk.gray(`   Status:  ${approval.status}`));
        console.log(chalk.gray(`   Reason:  ${approval.reason}`));
        console.log(chalk.gray(`   Created: ${approval.created_at}`));
        if (approval.resolution) {
          console.log(chalk.gray(`   Result:  ${approval.resolution}`));
        }
        console.log();
      }

      console.log(chalk.gray('Approve: hive approvals approve <id> -m "guidance"'));
      console.log(chalk.gray('Deny:    hive approvals deny <id> -m "reason"'));
    });
  });

approvalsCommand
  .command('show <id>')
  .description('Show a human approval request')
  .action(async (id: string) => {
    await withHiveContext(async ({ db }) => {
      const approval = ensureHumanApprovalEscalation(getEscalationById(db.db, id), id);
      const type = classifyApproval(approval.reason);

      console.log(chalk.bold(`\nApproval: ${approval.id}\n`));
      console.log(chalk.bold('Type:'), type);
      console.log(chalk.bold('Agent:'), approval.from_agent_id || '-');
      console.log(chalk.bold('Story:'), approval.story_id || '-');
      console.log(chalk.bold('Status:'), approval.status);
      console.log(chalk.bold('Created:'), approval.created_at);
      console.log(chalk.bold('\nReason:'));
      console.log(chalk.gray(approval.reason));

      if (approval.resolution) {
        console.log(chalk.bold('\nResolution:'));
        console.log(chalk.gray(approval.resolution));
      }
    });
  });

approvalsCommand
  .command('approve <id>')
  .description('Approve a pending human approval request')
  .option('-m, --message <message>', 'Optional guidance sent as approval context')
  .action(async (id: string, options: { message?: string }) => {
    await withHiveContext(async ({ db }) => {
      const approval = ensureHumanApprovalEscalation(getEscalationById(db.db, id), id);
      if (approval.status === 'resolved') {
        console.log(chalk.yellow(`Approval ${id} is already resolved.`));
        return;
      }

      const note = options.message?.trim() || 'Approved by human reviewer.';
      resolveEscalation(db.db, id, `APPROVED: ${note}`);
      console.log(chalk.green(`Approved ${id}.`));
    });
  });

approvalsCommand
  .command('deny <id>')
  .description('Deny a pending human approval request')
  .requiredOption('-m, --message <message>', 'Reason/guidance for denial')
  .action(async (id: string, options: { message: string }) => {
    await withHiveContext(async ({ db }) => {
      const approval = ensureHumanApprovalEscalation(getEscalationById(db.db, id), id);
      if (approval.status === 'resolved') {
        console.log(chalk.yellow(`Approval ${id} is already resolved.`));
        return;
      }

      resolveEscalation(db.db, id, `DENIED: ${options.message}`);
      console.log(chalk.green(`Denied ${id}.`));
    });
  });
