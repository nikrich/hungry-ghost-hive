// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
import { loadEnvIntoProcess } from '../../auth/env-store.js';
import { TokenStore } from '../../auth/token-store.js';
import { loadConfig } from '../../config/loader.js';
import type { JiraConfig } from '../../config/schema.js';
import { createLog } from '../../db/queries/logs.js';
import { getStoryById } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { getHivePaths } from '../../utils/paths.js';
import { JiraClient } from './client.js';
import { getTransitions, transitionIssue } from './issues.js';
import type { JiraTransition } from './types.js';

/**
 * Build a reverse mapping from Hive status to candidate Jira status names.
 *
 * The config `status_mapping` maps Jira status name → Hive status.
 * We invert it so given a Hive status we know which Jira status names to target.
 * Multiple Jira statuses may map to the same Hive status (e.g., "To Do" and "Backlog" both → "draft").
 */
export function reverseStatusMapping(
  statusMapping: Record<string, string>
): Record<string, string[]> {
  const reverse: Record<string, string[]> = {};

  for (const [jiraStatus, hiveStatus] of Object.entries(statusMapping)) {
    if (!reverse[hiveStatus]) {
      reverse[hiveStatus] = [];
    }
    reverse[hiveStatus].push(jiraStatus);
  }

  return reverse;
}

/**
 * Find a Jira transition that targets one of the given Jira status names.
 *
 * Searches available transitions for an issue and returns the first one
 * whose `to.name` matches (case-insensitive) any of the target status names.
 */
export function findTransitionForStatus(
  transitions: JiraTransition[],
  targetStatusNames: string[]
): JiraTransition | undefined {
  const targetNamesLower = new Set(targetStatusNames.map(n => n.toLowerCase()));

  return transitions.find(t => targetNamesLower.has(t.to.name.toLowerCase()));
}

/**
 * Transition a Jira issue to match a Hive story status.
 *
 * 1. Reverses the status_mapping to find candidate Jira status names for the Hive status.
 * 2. Fetches available transitions for the issue.
 * 3. Finds a transition matching one of the candidate statuses.
 * 4. Executes the transition.
 *
 * @returns true if the transition was applied, false if skipped (no mapping or no matching transition).
 * @throws On API errors (callers should catch for graceful handling).
 */
export async function transitionJiraIssue(
  client: JiraClient,
  issueIdOrKey: string,
  hiveStatus: string,
  statusMapping: Record<string, string>
): Promise<boolean> {
  // Find candidate Jira status names for the given Hive status
  const reverseMap = reverseStatusMapping(statusMapping);
  const targetStatusNames = reverseMap[hiveStatus];

  if (!targetStatusNames || targetStatusNames.length === 0) {
    logger.debug(
      `No Jira status mapped for Hive status "${hiveStatus}", skipping transition for ${issueIdOrKey}`
    );
    return false;
  }

  // Fetch available transitions for the issue
  const { transitions } = await getTransitions(client, issueIdOrKey);

  // Find a matching transition
  const transition = findTransitionForStatus(transitions, targetStatusNames);

  if (!transition) {
    logger.debug(
      `No available Jira transition to [${targetStatusNames.join(', ')}] for issue ${issueIdOrKey}. ` +
        `Available: [${transitions.map(t => `${t.name} → ${t.to.name}`).join(', ')}]`
    );
    return false;
  }

  // Execute the transition
  await transitionIssue(client, issueIdOrKey, {
    transition: { id: transition.id },
  });

  logger.debug(
    `Transitioned Jira issue ${issueIdOrKey} to "${transition.to.name}" (transition: "${transition.name}")`
  );

  return true;
}

/**
 * Sync a Hive story's status change to Jira.
 *
 * High-level convenience function that handles the full flow:
 * - Checks if the story has a Jira issue key
 * - Creates a JiraClient
 * - Calls transitionJiraIssue
 * - Logs success/failure
 * - Never throws — failures are logged as warnings
 *
 * @param db - Database instance
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration with status_mapping
 * @param storyId - The story ID to sync
 * @param newStatus - The new Hive status
 */
export async function syncStoryStatusToJira(
  db: Database,
  tokenStore: TokenStore,
  config: JiraConfig,
  storyId: string,
  newStatus: string
): Promise<void> {
  // Skip if no status mapping configured
  if (!config.status_mapping || Object.keys(config.status_mapping).length === 0) {
    return;
  }

  // Look up the story to get its Jira issue key
  const story = getStoryById(db, storyId);
  if (!story?.external_issue_key) {
    return;
  }

  try {
    loadEnvIntoProcess();

    const client = new JiraClient({
      tokenStore,
      clientId: process.env.JIRA_CLIENT_ID || '',
      clientSecret: process.env.JIRA_CLIENT_SECRET || '',
    });

    const transitioned = await transitionJiraIssue(
      client,
      story.external_issue_key,
      newStatus,
      config.status_mapping
    );

    if (transitioned) {
      createLog(db, {
        agentId: 'manager',
        storyId,
        eventType: 'JIRA_TRANSITION_SUCCESS',
        message: `Transitioned Jira issue ${story.external_issue_key} for status change to "${newStatus}"`,
        metadata: { jiraKey: story.external_issue_key, hiveStatus: newStatus },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Failed to transition Jira issue ${story.external_issue_key} for story ${storyId}: ${message}`
    );
    createLog(db, {
      agentId: 'manager',
      storyId,
      eventType: 'JIRA_TRANSITION_FAILED',
      status: 'warn',
      message: `Failed to transition Jira issue ${story.external_issue_key} to "${newStatus}": ${message}`,
      metadata: { jiraKey: story.external_issue_key, hiveStatus: newStatus, error: message },
    });
  }
}

/**
 * Top-level entry point for integration hooks.
 *
 * Loads config and tokens from the hive root directory, checks if Jira
 * integration is enabled, and syncs the story status to Jira.
 * Never throws — all errors are caught and logged.
 *
 * @param root - Hive root directory
 * @param db - Database instance
 * @param storyId - The story ID whose status changed
 * @param newStatus - The new Hive status
 */
export async function syncStatusToJira(
  root: string,
  db: Database,
  storyId: string,
  newStatus: string
): Promise<void> {
  try {
    const paths = getHivePaths(root);
    const config = loadConfig(paths.hiveDir);

    if (config.integrations.project_management.provider !== 'jira') {
      return;
    }

    const jiraConfig = config.integrations.project_management.jira;
    if (!jiraConfig) {
      return;
    }

    const envPath = join(paths.hiveDir, '.env');
    const tokenStore = new TokenStore(envPath);
    await tokenStore.loadFromEnv(envPath);

    await syncStoryStatusToJira(db, tokenStore, jiraConfig, storyId, newStatus);
  } catch (err) {
    // Never block the pipeline — log and continue
    logger.debug(
      `Failed to sync status to Jira for story ${storyId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
