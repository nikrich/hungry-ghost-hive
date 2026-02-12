// Licensed under the Hungry Ghost Hive License. See LICENSE.

import chalk from 'chalk';
import { Command } from 'commander';
import { join } from 'path';
import { loadEnvIntoProcess } from '../../auth/env-store.js';
import { TokenStore } from '../../auth/token-store.js';
import { adfToPlainText } from '../../integrations/jira/adf-utils.js';
import { JiraClient } from '../../integrations/jira/client.js';
import { parseEpicUrl } from '../../integrations/jira/epic-import.js';
import { getIssue, searchJql } from '../../integrations/jira/issues.js';
import type { JiraIssue } from '../../integrations/jira/types.js';
import { withHiveRoot } from '../../utils/with-hive-context.js';

/**
 * Create a JiraClient from the stored OAuth tokens.
 * Loads .hive/.env into process.env first so all stored credentials are available.
 */
async function createJiraClient(root: string, hiveDir: string): Promise<JiraClient> {
  // Load .hive/.env into process.env so client credentials are available
  loadEnvIntoProcess(root);

  const tokenStore = new TokenStore(join(hiveDir, '.env'));
  await tokenStore.loadFromEnv();

  const clientId = process.env.JIRA_CLIENT_ID || process.env.JIRA_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.JIRA_CLIENT_SECRET || process.env.JIRA_OAUTH_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    console.error(chalk.yellow('Warning: JIRA_CLIENT_ID / JIRA_CLIENT_SECRET not set.'));
    console.error(chalk.yellow('Token refresh will fail if the access token has expired.'));
    console.error(
      chalk.gray('Set JIRA_OAUTH_CLIENT_ID and JIRA_OAUTH_CLIENT_SECRET in your shell environment.')
    );
  }

  return new JiraClient({ tokenStore, clientId, clientSecret });
}

/**
 * Format a Jira issue for terminal display.
 */
function formatIssue(issue: JiraIssue, verbose: boolean): string {
  const lines: string[] = [];
  const status = issue.fields.status?.name || 'Unknown';
  const type = issue.fields.issuetype?.name || 'Unknown';
  const priority = issue.fields.priority?.name;
  const assignee = issue.fields.assignee?.displayName;
  const labels = issue.fields.labels?.length ? issue.fields.labels.join(', ') : undefined;
  const parent = issue.fields.parent;

  lines.push(chalk.bold.cyan(issue.key) + '  ' + chalk.bold(issue.fields.summary));
  lines.push(
    chalk.gray('  Type: ') +
      type +
      chalk.gray('  Status: ') +
      status +
      (priority ? chalk.gray('  Priority: ') + priority : '') +
      (assignee ? chalk.gray('  Assignee: ') + assignee : '')
  );

  if (parent) {
    lines.push(chalk.gray('  Parent: ') + parent.key);
  }

  if (labels) {
    lines.push(chalk.gray('  Labels: ') + labels);
  }

  if (verbose && issue.fields.description) {
    const desc = adfToPlainText(issue.fields.description);
    if (desc) {
      lines.push('');
      lines.push(chalk.gray('  Description:'));
      for (const line of desc.split('\n')) {
        lines.push('    ' + line);
      }
    }
  }

  return lines.join('\n');
}

export const jiraCommand = new Command('jira').description('Interact with Jira');

// ── hive jira fetch <key-or-url> ─────────────────────────────────────────────

jiraCommand
  .command('fetch')
  .description('Fetch a Jira issue by key (e.g. HIVE-3) or URL')
  .argument('<issue>', 'Issue key (HIVE-3) or Jira URL')
  .option('--json', 'Output raw JSON')
  .action(async (issue: string, options: { json?: boolean }) => {
    const { root, paths } = withHiveRoot(ctx => ctx);
    const client = await createJiraClient(root, paths.hiveDir);

    // Resolve key from URL if needed
    let issueKey = issue;
    if (issue.startsWith('http')) {
      const parsed = parseEpicUrl(issue);
      if (!parsed) {
        console.error(chalk.red('Could not parse Jira URL. Supported formats:'));
        console.log(chalk.gray('  https://site.atlassian.net/browse/KEY-123'));
        console.log(chalk.gray('  https://site.atlassian.net/issues/KEY-123'));
        process.exit(1);
      }
      issueKey = parsed.issueKey;
    }

    try {
      const result = await getIssue(client, issueKey);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatIssue(result, true));

        // If it's an epic, also fetch children
        try {
          const children = await searchJql(client, `parent = ${issueKey} ORDER BY created ASC`, {
            maxResults: 50,
          });

          if (children.issues.length > 0) {
            console.log('');
            console.log(chalk.bold(`  Child issues (${children.issues.length}):`));
            for (const child of children.issues) {
              const st = child.fields.status?.name || '';
              const tp = child.fields.issuetype?.name || '';
              console.log(
                '    ' +
                  chalk.cyan(child.key) +
                  '  ' +
                  chalk.gray(`[${tp}]`) +
                  ' ' +
                  child.fields.summary +
                  '  ' +
                  chalk.yellow(`(${st})`)
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

// ── hive jira search <jql> ──────────────────────────────────────────────────

jiraCommand
  .command('search')
  .description('Search Jira issues using JQL')
  .argument('<jql>', 'JQL query string')
  .option('-n, --max <number>', 'Maximum results', '20')
  .option('--json', 'Output raw JSON')
  .action(async (jql: string, options: { max: string; json?: boolean }) => {
    const { root, paths } = withHiveRoot(ctx => ctx);
    const client = await createJiraClient(root, paths.hiveDir);

    try {
      const results = await searchJql(client, jql, {
        maxResults: parseInt(options.max, 10),
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(
          chalk.gray(
            `Found ${results.issues.length} issues${results.isLast === false ? ' (more available)' : ''}:`
          )
        );
        console.log('');
        for (const issue of results.issues) {
          console.log(formatIssue(issue, false));
          console.log('');
        }
      }
    } catch (err) {
      console.error(chalk.red('Jira search failed'));
      if (err && typeof err === 'object' && 'responseBody' in err) {
        console.error(chalk.gray((err as { responseBody: string }).responseBody));
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
