// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type Database from 'better-sqlite3';
import { loadEnvIntoProcess } from '../../auth/env-store.js';
import { TokenStore } from '../../auth/token-store.js';
import { loadConfig } from '../../config/loader.js';
import type { JiraConfig } from '../../config/schema.js';
import {
  queryAll,
  queryOne,
  withTransaction,
  type RequirementRow,
  type StoryRow,
} from '../../db/client.js';
import { getAgentById } from '../../db/queries/agents.js';
import { createLog } from '../../db/queries/logs.js';
import { getStoryById, updateStory, type StoryStatus } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { getHivePaths } from '../../utils/paths.js';
import { JiraClient } from './client.js';
import { createSubtask, postComment } from './comments.js';
import { getIssue } from './issues.js';
import { syncRequirementToJira, tryMoveToActiveSprint } from './stories.js';
import { syncStoryStatusToJira, transitionJiraIssue } from './transitions.js';

/**
 * Ordered lifecycle stages for Hive stories.
 * Used to prevent bidirectional sync from regressing story status.
 */
const STATUS_LIFECYCLE_ORDER: string[] = [
  'draft',
  'estimated',
  'planned',
  'in_progress',
  'review',
  'qa',
  'qa_failed',
  'pr_submitted',
  'merged',
];

/**
 * Check if transitioning from currentStatus to newStatus would be a regression.
 * Returns true if the new status is earlier in the lifecycle than the current one.
 */
function isStatusRegression(currentStatus: string, newStatus: string): boolean {
  const currentIdx = STATUS_LIFECYCLE_ORDER.indexOf(currentStatus);
  const newIdx = STATUS_LIFECYCLE_ORDER.indexOf(newStatus);
  // If either status is unknown, allow the transition
  if (currentIdx === -1 || newIdx === -1) return false;
  return newIdx < currentIdx;
}

/**
 * Status progression order for the Hive pipeline.
 * Higher numbers represent further progress. Used to prevent
 * Jira sync from regressing stories backward.
 */
const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  estimated: 1,
  planned: 2,
  in_progress: 3,
  review: 4,
  pr_submitted: 5,
  qa: 6,
  qa_failed: 4, // allowed as a backward step from qa
  merged: 7,
};

/**
 * Check whether transitioning from currentStatus to newStatus is a
 * forward (or lateral) move in the pipeline.
 */
export function isForwardTransition(currentStatus: string, newStatus: string): boolean {
  const currentOrder = STATUS_ORDER[currentStatus] ?? -1;
  const newOrder = STATUS_ORDER[newStatus] ?? -1;
  return newOrder >= currentOrder;
}

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
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Skip if no status mapping configured
  if (!config.status_mapping || Object.keys(config.status_mapping).length === 0) {
    logger.debug('No Jira status mapping configured, skipping bidirectional sync');
    return 0;
  }

  // Fetch all stories that have an external issue key (provider-agnostic query)
  const storiesWithJira = queryAll<StoryRow>(
    db,
    `SELECT * FROM stories WHERE external_issue_key IS NOT NULL AND status NOT IN ('merged')`
  );

  if (storiesWithJira.length === 0) {
    return 0;
  }

  loadEnvIntoProcess();

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  let updatedCount = 0;

  for (const story of storiesWithJira) {
    try {
      // Fetch current Jira issue status
      const jiraIssue = await getIssue(client, story.external_issue_key!, ['status']);
      const jiraStatusName = jiraIssue.fields.status.name;

      // Convert Jira status to Hive status
      const mappedHiveStatus = jiraStatusToHiveStatus(jiraStatusName, config.status_mapping);

      if (!mappedHiveStatus) {
        logger.debug(
          `No Hive status mapping for Jira status "${jiraStatusName}" (${story.external_issue_key}), skipping`
        );
        continue;
      }

      // Check if status differs from current Hive status
      // Guard: never regress status backward in the lifecycle
      if (isStatusRegression(story.status, mappedHiveStatus)) {
        logger.debug(
          `Skipping Jira sync for ${story.id}: would regress ${story.status} → ${mappedHiveStatus}`
        );
        continue;
      }

      if (mappedHiveStatus !== story.status) {
        // Only allow forward transitions — never regress stories backward
        if (!isForwardTransition(story.status, mappedHiveStatus)) {
          logger.debug(
            `Skipping backward Jira sync for story ${story.id} (${story.external_issue_key}): ` +
              `would regress ${story.status} → ${mappedHiveStatus} (Jira: "${jiraStatusName}")`
          );
          continue;
        }

        // Update the story status in Hive
        await withTransaction(db, () => {
          updateStory(db, story.id, { status: mappedHiveStatus as StoryStatus });

          createLog(db, {
            agentId: 'manager',
            storyId: story.id,
            eventType: 'JIRA_SYNC_COMPLETED',
            message: `Synced status from Jira: ${story.status} → ${mappedHiveStatus} (Jira: "${jiraStatusName}")`,
            metadata: {
              jiraKey: story.external_issue_key,
              oldHiveStatus: story.status,
              newHiveStatus: mappedHiveStatus,
              jiraStatus: jiraStatusName,
            },
          });
        });

        logger.debug(
          `Synced Jira status for story ${story.id} (${story.external_issue_key}): ${story.status} → ${mappedHiveStatus}`
        );

        updatedCount++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Failed to sync Jira status for story ${story.id} (${story.external_issue_key}): ${message}`
      );

      createLog(db, {
        agentId: 'manager',
        storyId: story.id,
        eventType: 'JIRA_SYNC_WARNING',
        status: 'warn',
        message: `Failed to sync status from Jira: ${message}`,
        metadata: { jiraKey: story.external_issue_key, error: message },
      });
    }
  }

  return updatedCount;
}

/**
 * Detect stories that exist in the Hive DB but have no Jira issue key,
 * and sync them to Jira by creating issues under the requirement's epic.
 *
 * This catches stories inserted directly into the DB (e.g., by the tech lead
 * via SQL) that bypassed the normal sync flow.
 *
 * @param db - Database instance
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration
 * @returns Number of stories synced to Jira
 */
export async function syncUnsyncedStoriesToJira(
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Find stories that have no external_issue_key but are not in draft status
  const unsyncedStories = queryAll<StoryRow>(
    db,
    `SELECT * FROM stories WHERE external_issue_key IS NULL AND status NOT IN ('draft') ORDER BY requirement_id, id`
  );

  if (unsyncedStories.length === 0) {
    return 0;
  }

  logger.info(`Found ${unsyncedStories.length} unsynced story(ies) — syncing to Jira`);

  // Group stories by requirement_id so we can batch-sync per epic
  const byRequirement = new Map<string | null, StoryRow[]>();
  for (const story of unsyncedStories) {
    const reqId = story.requirement_id ?? null;
    if (!byRequirement.has(reqId)) {
      byRequirement.set(reqId, []);
    }
    byRequirement.get(reqId)!.push(story);
  }

  let syncedCount = 0;

  for (const [requirementId, stories] of byRequirement) {
    try {
      if (!requirementId) {
        logger.warn(`Skipping ${stories.length} unsynced stories with no requirement_id`);
        continue;
      }

      const requirement = queryOne<RequirementRow>(db, `SELECT * FROM requirements WHERE id = ?`, [
        requirementId,
      ]);

      if (!requirement) {
        logger.warn(`Requirement ${requirementId} not found, skipping ${stories.length} stories`);
        continue;
      }

      // Get the team name from the first story's team_id
      const teamName = stories[0].team_id ?? undefined;

      // Re-query guard: double-check each story still has no jira_issue_key
      // (another sync cycle may have updated it since our initial query)
      const confirmedStoryIds: string[] = [];
      for (const s of stories) {
        const fresh = getStoryById(db, s.id);
        if (fresh && !fresh.jira_issue_key) {
          confirmedStoryIds.push(s.id);
        } else {
          logger.debug(`Story ${s.id} now has Jira key, skipping re-sync`);
        }
      }

      if (confirmedStoryIds.length === 0) {
        continue;
      }

      const result = await syncRequirementToJira(
        db,
        tokenStore,
        config,
        requirement,
        confirmedStoryIds,
        teamName
      );

      syncedCount += result.stories.length;

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          logger.warn(`Jira sync error: ${err}`);
        }
      }

      if (result.stories.length > 0) {
        logger.info(
          `Synced ${result.stories.length} story(ies) to Jira for requirement ${requirementId} (epic: ${result.epicKey})`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to sync stories for requirement ${requirementId}: ${message}`);
    }
  }

  return syncedCount;
}

/**
 * Detect stories that were assigned to agents but missed the Jira
 * assignment hook (subtask creation + status transition).
 *
 * This happens when a story is assigned before its external_issue_key is set
 * (e.g., Jira sync hadn't completed yet). The original
 * handleJiraAfterAssignment() bails out with "no Jira issue key" and
 * never retries, leaving the story without a subtask in Jira.
 *
 * This repair function finds such stories and runs the assignment logic:
 * 1. Create a subtask under the parent Jira issue
 * 2. Post an "assigned" comment
 * 3. Transition the Jira issue to match the story's current Hive status
 *
 * @param db - Database instance
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration
 * @returns Number of stories repaired
 */
export async function repairMissedAssignmentHooks(
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Find stories that:
  // - Have an external_issue_key (synced to a PM provider)
  // - Have an assigned_agent_id (assigned to an agent)
  // - But are missing an external_subtask_key (subtask never created)
  const storiesMissingSubtasks = queryAll<StoryRow>(
    db,
    `SELECT * FROM stories
     WHERE external_issue_key IS NOT NULL
       AND assigned_agent_id IS NOT NULL
       AND external_subtask_key IS NULL
       AND status NOT IN ('merged')
     ORDER BY created_at`
  );

  if (storiesMissingSubtasks.length === 0) {
    return 0;
  }

  logger.info(
    `Found ${storiesMissingSubtasks.length} assigned story(ies) missing Jira subtasks — repairing`
  );

  loadEnvIntoProcess();

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  let repairedCount = 0;

  for (const story of storiesMissingSubtasks) {
    try {
      // Look up the assigned agent for naming
      const agent = getAgentById(db, story.assigned_agent_id!);
      const agentName = agent?.tmux_session || agent?.id || story.assigned_agent_id!;

      // Create the subtask
      const subtask = await createSubtask(client, {
        parentIssueKey: story.external_issue_key!,
        projectKey: story.external_project_key || config.project_key,
        agentName,
        storyTitle: story.title,
      });

      if (subtask) {
        // Persist subtask reference
        updateStory(db, story.id, {
          externalSubtaskKey: subtask.key,
          externalSubtaskId: subtask.id,
        });

        logger.info(
          `Repaired: created Jira subtask ${subtask.key} for story ${story.id} (agent: ${agentName})`
        );

        // Post "assigned" comment
        await postComment(client, story.external_issue_key!, 'assigned', {
          agentName,
          subtaskKey: subtask.key,
        });

        repairedCount++;

        createLog(db, {
          agentId: 'manager',
          storyId: story.id,
          eventType: 'JIRA_ASSIGNMENT_REPAIRED',
          message: `Repaired missed assignment hook: created subtask ${subtask.key} for agent ${agentName}`,
          metadata: {
            jiraKey: story.external_issue_key,
            subtaskKey: subtask.key,
            agentName,
          },
        });
      }

      // Transition the Jira issue to match the story's current status
      // (e.g., if the story is already in_progress, ensure Jira reflects that)
      if (story.status !== 'planned' && story.status !== 'draft') {
        await syncStoryStatusToJira(db, tokenStore, config, story.id, story.status);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to repair assignment hook for story ${story.id}: ${message}`);

      createLog(db, {
        agentId: 'manager',
        storyId: story.id,
        eventType: 'JIRA_ASSIGNMENT_REPAIR_FAILED',
        status: 'warn',
        message: `Failed to repair missed assignment hook: ${message}`,
        metadata: { jiraKey: story.external_issue_key, error: message },
      });
    }
  }

  return repairedCount;
}

/**
 * Retry sprint assignment for stories that have a Jira issue key
 * but were not successfully moved to the active sprint.
 *
 * @param db - Database instance
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration
 * @returns Number of stories moved to sprint
 */
export async function retrySprintAssignment(
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  const storiesNotInSprint = queryAll<StoryRow>(
    db,
    `SELECT * FROM stories
     WHERE jira_issue_key IS NOT NULL
       AND (in_sprint IS NULL OR in_sprint = 0)
       AND status NOT IN ('merged')
     ORDER BY created_at`
  );

  if (storiesNotInSprint.length === 0) {
    return 0;
  }

  logger.info(`Found ${storiesNotInSprint.length} story(ies) not in sprint — retrying assignment`);

  loadEnvIntoProcess();

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  const issueKeys = storiesNotInSprint.map(s => s.jira_issue_key!).filter(Boolean);

  const moved = await tryMoveToActiveSprint(client, config, issueKeys);
  if (moved) {
    for (const story of storiesNotInSprint) {
      updateStory(db, story.id, { inSprint: true });
    }
    return storiesNotInSprint.length;
  }

  return 0;
}

/**
 * Push Hive story status changes TO Jira.
 * This detects stories whose Hive status has advanced beyond their Jira status
 * and pushes the updated status to Jira.
 *
 * @param db - Database instance
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration with status_mapping
 * @returns Number of stories pushed to Jira
 */
export async function syncHiveStatusesToJira(
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Skip if no status mapping configured
  if (!config.status_mapping || Object.keys(config.status_mapping).length === 0) {
    logger.debug('No Jira status mapping configured, skipping Hive-to-Jira sync');
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

  loadEnvIntoProcess();

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  let pushedCount = 0;

  for (const story of storiesWithJira) {
    try {
      // Fetch current Jira issue status
      const jiraIssue = await getIssue(client, story.jira_issue_key!, ['status']);
      const jiraStatusName = jiraIssue.fields.status.name;

      // Convert Jira status to Hive status to compare
      const jiraStatusAsHiveStatus = jiraStatusToHiveStatus(jiraStatusName, config.status_mapping);

      if (!jiraStatusAsHiveStatus) {
        logger.debug(
          `No Hive status mapping for Jira status "${jiraStatusName}" (${story.jira_issue_key}), skipping`
        );
        continue;
      }

      // Check if Hive status is ahead of Jira status
      if (story.status !== jiraStatusAsHiveStatus) {
        // Only push forward transitions — never regress Jira backward
        if (!isForwardTransition(jiraStatusAsHiveStatus, story.status)) {
          logger.debug(
            `Skipping Hive-to-Jira push for story ${story.id} (${story.jira_issue_key}): ` +
              `would regress Jira from ${jiraStatusAsHiveStatus} → ${story.status} (Jira: "${jiraStatusName}")`
          );
          continue;
        }

        // Push the Hive status to Jira
        const transitioned = await transitionJiraIssue(
          client,
          story.jira_issue_key!,
          story.status,
          config.status_mapping
        );

        if (transitioned) {
          createLog(db, {
            agentId: 'manager',
            storyId: story.id,
            eventType: 'JIRA_SYNC_COMPLETED',
            message: `Pushed status to Jira: ${jiraStatusAsHiveStatus} → ${story.status} (was Jira: "${jiraStatusName}")`,
            metadata: {
              jiraKey: story.jira_issue_key,
              oldJiraStatus: jiraStatusName,
              oldHiveStatus: jiraStatusAsHiveStatus,
              newHiveStatus: story.status,
            },
          });

          logger.debug(
            `Pushed Hive status to Jira for story ${story.id} (${story.jira_issue_key}): ${jiraStatusAsHiveStatus} → ${story.status}`
          );

          pushedCount++;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Failed to push Hive status to Jira for story ${story.id} (${story.jira_issue_key}): ${message}`
      );

      createLog(db, {
        agentId: 'manager',
        storyId: story.id,
        eventType: 'JIRA_SYNC_WARNING',
        status: 'warn',
        message: `Failed to push status to Jira: ${message}`,
        metadata: { jiraKey: story.jira_issue_key, error: message },
      });
    }
  }

  return pushedCount;
}

/**
 * Top-level entry point for Jira bidirectional sync.
 *
 * Loads config and tokens from the hive root directory, checks if Jira
 * integration is enabled, and:
 * 1. Syncs unsynced stories TO Jira (creates missing Jira issues)
 * 2. Syncs Jira statuses back to Hive (bidirectional status sync)
 * 3. Pushes Hive status changes TO Jira (periodic status push)
 *
 * Never throws — all errors are caught and logged.
 *
 * @param root - Hive root directory
 * @param db - Database instance
 * @returns Number of stories updated (from bidirectional status sync)
 */
export async function syncFromJira(root: string, db: Database.Database): Promise<number> {
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

    // First: push any unsynced stories TO Jira
    await syncUnsyncedStoriesToJira(db, tokenStore, jiraConfig);

    // Then: repair any assigned stories that missed the Jira assignment hook
    await repairMissedAssignmentHooks(db, tokenStore, jiraConfig);

    // Retry sprint assignment for stories that failed to move into a sprint
    await retrySprintAssignment(db, tokenStore, jiraConfig);

    // Next: pull status updates FROM Jira
    const pulledCount = await syncJiraStatusesToHive(db, tokenStore, jiraConfig);

    // Finally: push Hive status updates TO Jira
    await syncHiveStatusesToJira(db, tokenStore, jiraConfig);

    return pulledCount;
  } catch (err) {
    // Never block the pipeline — log and continue
    logger.debug(`Failed to sync from Jira: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
