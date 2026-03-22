// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import {
  getTokensByAgent,
  getTokensByStory,
  getTotalTokens,
} from '../../db/queries/token-usage.js';
import { withReadOnlyHiveContext } from '../../utils/with-hive-context.js';

export const tokensCommand = new Command('tokens').description('View token usage statistics');

tokensCommand
  .description('Show token usage overview')
  .option('--since <date>', 'Filter records after this date (ISO format)')
  .option('--until <date>', 'Filter records before this date (ISO format)')
  .option('--json', 'Output as JSON')
  .action(async (options: { since?: string; until?: string; json?: boolean }) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      const summary = await getTotalTokens(db.provider, {
        since: options.since,
        until: options.until,
      });

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(chalk.bold('\nToken Usage Overview:\n'));
      console.log(chalk.gray(`  Input tokens:  ${summary.total_input_tokens.toLocaleString()}`));
      console.log(chalk.gray(`  Output tokens: ${summary.total_output_tokens.toLocaleString()}`));
      console.log(chalk.bold(`  Total tokens:  ${summary.total_tokens.toLocaleString()}`));
      console.log(chalk.gray(`  Records:       ${summary.record_count.toLocaleString()}`));
      console.log();
    });
  });

tokensCommand
  .command('agent <agent-id>')
  .description('Show token usage for a specific agent')
  .option('--json', 'Output as JSON')
  .action(async (agentId: string, options: { json?: boolean }) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      const rows = await getTokensByAgent(db.provider, agentId);

      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log(chalk.yellow(`No token usage records found for agent: ${agentId}`));
        return;
      }

      const totalInput = rows.reduce((sum, r) => sum + r.input_tokens, 0);
      const totalOutput = rows.reduce((sum, r) => sum + r.output_tokens, 0);
      const totalTokens = rows.reduce((sum, r) => sum + r.total_tokens, 0);

      console.log(chalk.bold(`\nToken Usage for Agent: ${agentId}\n`));

      console.log(
        chalk.gray(
          `${'Recorded At'.padEnd(22)} ${'Story'.padEnd(20)} ${'Model'.padEnd(15)} ${'Input'.padEnd(10)} ${'Output'.padEnd(10)} ${'Total'}`
        )
      );
      console.log(chalk.gray('─'.repeat(90)));

      for (const row of rows) {
        const time = new Date(row.recorded_at).toISOString().substring(0, 19).replace('T', ' ');
        const story = (row.story_id || '-').padEnd(20);
        const model = (row.model || '-').padEnd(15);
        console.log(
          `${chalk.gray(time.padEnd(22))} ${story} ${model} ${String(row.input_tokens).padEnd(10)} ${String(row.output_tokens).padEnd(10)} ${row.total_tokens}`
        );
      }

      console.log(chalk.gray('─'.repeat(90)));
      console.log(
        chalk.bold(
          `${'TOTAL'.padEnd(22)} ${' '.padEnd(20)} ${' '.padEnd(15)} ${String(totalInput).padEnd(10)} ${String(totalOutput).padEnd(10)} ${totalTokens}`
        )
      );
      console.log();
    });
  });

tokensCommand
  .command('story <story-id>')
  .description('Show token usage for a specific story')
  .option('--json', 'Output as JSON')
  .action(async (storyId: string, options: { json?: boolean }) => {
    await withReadOnlyHiveContext(async ({ db }) => {
      const rows = await getTokensByStory(db.provider, storyId);

      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log(chalk.yellow(`No token usage records found for story: ${storyId}`));
        return;
      }

      const totalInput = rows.reduce((sum, r) => sum + r.input_tokens, 0);
      const totalOutput = rows.reduce((sum, r) => sum + r.output_tokens, 0);
      const totalTokens = rows.reduce((sum, r) => sum + r.total_tokens, 0);

      console.log(chalk.bold(`\nToken Usage for Story: ${storyId}\n`));

      console.log(
        chalk.gray(
          `${'Recorded At'.padEnd(22)} ${'Agent'.padEnd(25)} ${'Model'.padEnd(15)} ${'Input'.padEnd(10)} ${'Output'.padEnd(10)} ${'Total'}`
        )
      );
      console.log(chalk.gray('─'.repeat(95)));

      for (const row of rows) {
        const time = new Date(row.recorded_at).toISOString().substring(0, 19).replace('T', ' ');
        const agent = row.agent_id.padEnd(25);
        const model = (row.model || '-').padEnd(15);
        console.log(
          `${chalk.gray(time.padEnd(22))} ${agent} ${model} ${String(row.input_tokens).padEnd(10)} ${String(row.output_tokens).padEnd(10)} ${row.total_tokens}`
        );
      }

      console.log(chalk.gray('─'.repeat(95)));
      console.log(
        chalk.bold(
          `${'TOTAL'.padEnd(22)} ${' '.padEnd(25)} ${' '.padEnd(15)} ${String(totalInput).padEnd(10)} ${String(totalOutput).padEnd(10)} ${totalTokens}`
        )
      );
      console.log();
    });
  });
