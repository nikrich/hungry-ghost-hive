// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { JiraClient } from './client.js';
import { getIssue } from './issues.js';
import { adfToPlainText } from './adf-utils.js';
import type { JiraIssue } from './types.js';

/** Result from parsing a Jira URL */
export interface ParsedEpicUrl {
  /** The issue key extracted from the URL (e.g., "HIVE-2") */
  issueKey: string;
  /** The Jira site URL (e.g., "https://nikrich.atlassian.net") */
  siteUrl: string;
}

/** Fetched epic data ready for requirement creation */
export interface FetchedEpic {
  key: string;
  id: string;
  title: string;
  description: string;
  issue: JiraIssue;
}

/**
 * Check whether a string looks like a Jira URL.
 * Matches typical Atlassian cloud URLs containing /browse/, /issues/, or
 * ?selectedIssue= with a project key pattern.
 */
export function isJiraUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // Must be https
    if (url.protocol !== 'https:') return false;
    // Must look like an Atlassian cloud or self-hosted Jira URL
    if (
      url.pathname.match(/\/browse\/[A-Z][A-Z0-9]+-\d+/) ||
      url.pathname.match(/\/issues\/[A-Z][A-Z0-9]+-\d+/) ||
      url.searchParams.get('selectedIssue')?.match(/^[A-Z][A-Z0-9]+-\d+$/)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse a Jira URL and extract the issue key and site URL.
 *
 * Supported formats:
 *   - https://site.atlassian.net/browse/KEY-123
 *   - https://site.atlassian.net/issues/KEY-123
 *   - https://site.atlassian.net/jira/software/projects/KEY/boards/1?selectedIssue=KEY-123
 */
export function parseEpicUrl(url: string): ParsedEpicUrl | null {
  try {
    const parsed = new URL(url);
    const siteUrl = `${parsed.protocol}//${parsed.host}`;

    // Format: /browse/KEY-123
    const browseMatch = parsed.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
    if (browseMatch) {
      return { issueKey: browseMatch[1], siteUrl };
    }

    // Format: /issues/KEY-123
    const issuesMatch = parsed.pathname.match(/\/issues\/([A-Z][A-Z0-9]+-\d+)/);
    if (issuesMatch) {
      return { issueKey: issuesMatch[1], siteUrl };
    }

    // Format: ?selectedIssue=KEY-123
    const selectedIssue = parsed.searchParams.get('selectedIssue');
    if (selectedIssue && /^[A-Z][A-Z0-9]+-\d+$/.test(selectedIssue)) {
      return { issueKey: selectedIssue, siteUrl };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch an epic from Jira by its issue key, returning structured data
 * suitable for creating a Hive requirement.
 */
export async function fetchEpicFromJira(
  client: JiraClient,
  issueKey: string
): Promise<FetchedEpic> {
  const issue = await getIssue(client, issueKey, [
    'summary',
    'description',
    'status',
    'issuetype',
    'labels',
    'project',
    'created',
  ]);

  const title = issue.fields.summary;
  const description = adfToPlainText(issue.fields.description) || title;

  return {
    key: issue.key,
    id: issue.id,
    title,
    description,
    issue,
  };
}
