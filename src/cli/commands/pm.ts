// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';
import type { ConnectorIssue } from '../../connectors/common-types.js';
import { registry } from '../../connectors/registry.js';
import { withHiveRoot } from '../../utils/with-hive-context.js';

/**
 * Format an issue for terminal display using provider-agnostic fields.
 */
function formatIssue(issue: ConnectorIssue, verbose: boolean): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan(issue.key) + '  ' + chalk.bold(issue.title));
  lines.push(
    chalk.gray('  Type: ') +
      issue.issueType +
      chalk.gray('  Status: ') +
      issue.status +
      (issue.storyPoints ? chalk.gray('  Points: ') + issue.storyPoints : '') +
      (issue.assignee ? chalk.gray('  Assignee: ') + issue.assignee : '')
  );

  if (issue.parentKey) {
    lines.push(chalk.gray('  Parent: ') + issue.parentKey);
  }

  if (issue.labels.length > 0) {
    lines.push(chalk.gray('  Labels: ') + issue.labels.join(', '));
  }

  if (verbose && issue.description) {
    lines.push('');
    lines.push(chalk.gray('  Description:'));
    for (const line of issue.description.split('\n')) {
      lines.push('    ' + line);
    }
  }

  return lines.join('\n');
}

export const pmCommand = new Command('pm').description(
  'Interact with configured project management tool'
);

// ── hive pm fetch <key-or-url> ───────────────────────────────────────────────

pmCommand
  .command('fetch')
  .description('Fetch an issue by key (e.g. HIVE-3) or URL')
  .argument('<issue>', 'Issue key or URL')
  .option('--json', 'Output raw JSON')
  .action(async (issue: string, options: { json?: boolean }) => {
    const { paths } = withHiveRoot(ctx => ctx);
    const config = loadConfig(paths.hiveDir);

    const pmProvider = config.integrations.project_management.provider;
    if (pmProvider === 'none') {
      console.error(chalk.red('No project management provider configured.'));
      console.log(
        chalk.gray(
          'Run "hive config" and set integrations.project_management.provider to "jira" or another supported provider.'
        )
      );
      process.exit(1);
    }

    const pmConnector = registry.getProjectManagement(pmProvider);
    if (!pmConnector) {
      console.error(chalk.red(`Project management connector not found for provider: ${pmProvider}`));
      process.exit(1);
    }

    // Resolve key from URL if needed
    let issueKey = issue;
    if (issue.startsWith('http')) {
      if (!pmConnector.isEpicUrl(issue)) {
        console.error(chalk.red(`Could not parse ${pmProvider} URL. Unsupported format.`));
        process.exit(1);
      }
      const parsed = pmConnector.parseEpicUrl(issue);
      if (!parsed) {
        console.error(chalk.red(`Could not parse ${pmProvider} URL.`));
        process.exit(1);
      }
      issueKey = parsed.issueKey;
    }

    try {
      const result = await pmConnector.getIssue(issueKey);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatIssue(result, true));

        // If it's an epic-like issue, try to fetch children
        // For Jira, this would be "parent = KEY", for other providers it might differ
        try {
          // Provider-specific query syntax - each connector defines its own
          const childQuery =
            pmProvider === 'jira'
              ? `parent = ${issueKey} ORDER BY created ASC`
              : `parent:${issueKey}`;

          const children = await pmConnector.searchIssues(childQuery, { maxResults: 50 });

          if (children.length > 0) {
            console.log('');
            console.log(chalk.bold(`  Child issues (${children.length}):`));
            for (const child of children) {
              console.log(
                '    ' +
                  chalk.cyan(child.key) +
                  '  ' +
                  chalk.gray(`[${child.issueType}]`) +
                  ' ' +
                  child.title +
                  '  ' +
                  chalk.yellow(`(${child.status})`)
              );
            }
          }
        } catch {
          // Child issue search may fail for non-epic issues — that's fine
        }
      }
    } catch (err) {
      console.error(chalk.red(`Failed to fetch issue ${issueKey}`));
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── hive pm search <query> ───────────────────────────────────────────────────

pmCommand
  .command('search')
  .description('Search issues using provider-specific query syntax')
  .argument('<query>', 'Query string (e.g., JQL for Jira)')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--json', 'Output raw JSON')
  .action(async (query: string, options: { max: string; json?: boolean }) => {
    const { paths } = withHiveRoot(ctx => ctx);
    const config = loadConfig(paths.hiveDir);

    const pmProvider = config.integrations.project_management.provider;
    if (pmProvider === 'none') {
      console.error(chalk.red('No project management provider configured.'));
      console.log(
        chalk.gray(
          'Run "hive config" and set integrations.project_management.provider to "jira" or another supported provider.'
        )
      );
      process.exit(1);
    }

    const pmConnector = registry.getProjectManagement(pmProvider);
    if (!pmConnector) {
      console.error(chalk.red(`Project management connector not found for provider: ${pmProvider}`));
      process.exit(1);
    }

    try {
      const results = await pmConnector.searchIssues(query, {
        maxResults: parseInt(options.max, 10),
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(
          chalk.gray(
            `Found ${results.length} issues${results.length === parseInt(options.max, 10) ? ' (more may be available)' : ''}:`
          )
        );
        console.log('');
        for (const issue of results) {
          console.log(formatIssue(issue, false));
          console.log('');
        }
      }
    } catch (err) {
      console.error(chalk.red(`${pmProvider} search failed`));
      if (err && typeof err === 'object' && 'responseBody' in err) {
        console.error(chalk.gray((err as { responseBody: string }).responseBody));
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── hive pm sync ──────────────────────────────────────────────────────────────

pmCommand
  .command('sync')
  .description('Trigger bidirectional sync with configured PM tool')
  .action(async () => {
    const { paths } = withHiveRoot(ctx => ctx);
    const config = loadConfig(paths.hiveDir);

    const pmProvider = config.integrations.project_management.provider;
    if (pmProvider === 'none') {
      console.error(chalk.red('No project management provider configured.'));
      console.log(
        chalk.gray(
          'Run "hive config" and set integrations.project_management.provider to "jira" or another supported provider.'
        )
      );
      process.exit(1);
    }

    // For now, sync is provider-specific and not part of the connector interface
    // This is a placeholder for future implementation
    console.log(chalk.yellow('PM sync is not yet implemented via the connector interface.'));
    console.log(
      chalk.gray(
        `For ${pmProvider}, sync happens automatically during story creation and status transitions.`
      )
    );
  });
