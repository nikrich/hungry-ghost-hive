// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
import { TokenStore } from '../../auth/token-store.js';
import { loadConfig } from '../../config/loader.js';
import type { JiraConfig } from '../../config/schema.js';
import { queryAll, type StoryRow, withTransaction } from '../../db/client.js';
import { createLog } from '../../db/queries/logs.js';
import { updateStory, type StoryStatus } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { getHivePaths } from '../../utils/paths.js';
import { JiraClient } from './client.js';
import { getIssue } from './issues.js';

/**
 * Convert a Jira status name to a Hive status using the configured status mapping.
 * @param jiraStatusName - The Jira status name (e.g., "In Progress")
 * @param statusMapping - The status mapping from config (Jira status → Hive status)
 * @returns The Hive status, or null if no mapping found
 */
export function jiraStatusToHiveStatus(
  jiraStatusName: string,
  statusMapping: Record<string, string>
): string | null {
  const normalizedJiraStatus = jiraStatusName.toLowerCase();

  // Try exact match first (case-insensitive)
  for (const [jiraStatus, hiveStatus] of Object.entries(statusMapping)) {
    if (jiraStatus.toLowerCase() === normalizedJiraStatus) {
      return hiveStatus;
    }
  }

  return null;
}

/**
 * Sync Jira issue statuses back to the Hive database.
 * This detects manual status changes in Jira (e.g., dragging cards on the board)
 * and updates the corresponding stories in the Hive database.
 *
 * @param db - Database instance
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration with status_mapping
 * @returns Number of stories updated
 */
export async function syncJiraStatusesToHive(
  db: Database,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Skip if no status mapping configured
  if (!config.status_mapping || Object.keys(config.status_mapping).length === 0) {
    logger.debug('No Jira status mapping configured, skipping bidirectional sync');
    return 0;
  }

  // Fetch all stories that have a Jira issue key
  const storiesWithJira = queryAll<StoryRow>(
    db,
    `SELECT * FROM stories WHERE jira_issue_key IS NOT NULL AND status NOT IN ('merged')`
  );

  if (storiesWithJira.length === 0) {
    return 0;
  }

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  let updatedCount = 0;

  for (const story of storiesWithJira) {
    try {
      // Fetch current Jira issue status
      const jiraIssue = await getIssue(client, story.jira_issue_key!, ['status']);
      const jiraStatusName = jiraIssue.fields.status.name;

      // Convert Jira status to Hive status
      const mappedHiveStatus = jiraStatusToHiveStatus(jiraStatusName, config.status_mapping);

      if (!mappedHiveStatus) {
        logger.debug(
          `No Hive status mapping for Jira status "${jiraStatusName}" (${story.jira_issue_key}), skipping`
        );
        continue;
      }

      // Check if status differs from current Hive status
      if (mappedHiveStatus !== story.status) {
        // Update the story status in Hive
        await withTransaction(db, () => {
          updateStory(db, story.id, { status: mappedHiveStatus as StoryStatus });

          createLog(db, {
            agentId: 'manager',
            storyId: story.id,
            eventType: 'JIRA_SYNC_COMPLETED',
            message: `Synced status from Jira: ${story.status} → ${mappedHiveStatus} (Jira: "${jiraStatusName}")`,
            metadata: {
              jiraKey: story.jira_issue_key,
              oldHiveStatus: story.status,
              newHiveStatus: mappedHiveStatus,
              jiraStatus: jiraStatusName,
            },
          });
        });

        logger.debug(
          `Synced Jira status for story ${story.id} (${story.jira_issue_key}): ${story.status} → ${mappedHiveStatus}`
        );

        updatedCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Failed to sync Jira status for story ${story.id} (${story.jira_issue_key}): ${message}`
      );

      createLog(db, {
        agentId: 'manager',
        storyId: story.id,
        eventType: 'JIRA_SYNC_WARNING',
        status: 'warn',
        message: `Failed to sync status from Jira: ${message}`,
        metadata: { jiraKey: story.jira_issue_key, error: message },
      });
    }
  }

  return updatedCount;
}

/**
 * Top-level entry point for Jira bidirectional sync.
 *
 * Loads config and tokens from the hive root directory, checks if Jira
 * integration is enabled, and syncs Jira statuses back to Hive.
 * Never throws — all errors are caught and logged.
 *
 * @param root - Hive root directory
 * @param db - Database instance
 * @returns Number of stories updated
 */
export async function syncFromJira(root: string, db: Database): Promise<number> {
  try {
    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (config.integrations.project_management.provider !== 'jira') {
      return 0;
    }

    const jiraConfig = config.integrations.project_management.jira;
    if (!jiraConfig) {
      return 0;
    }

    const envPath = join(paths.hiveDir, '.env');
    const tokenStore = new TokenStore(envPath);
    await tokenStore.loadFromEnv(envPath);

    return await syncJiraStatusesToHive(db, tokenStore, jiraConfig);
  } catch (err) {
    // Never block the pipeline — log and continue
    logger.debug(
      `Failed to sync from Jira: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}
