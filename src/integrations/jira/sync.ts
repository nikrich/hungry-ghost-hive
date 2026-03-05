// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
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
import { createLog, type EventType } from '../../db/queries/logs.js';
import { getStoryById, updateStory, type StoryStatus } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { getHivePaths } from '../../utils/paths.js';
import { isForwardTransition, isStatusRegression } from '../../utils/story-status.js';
import { withHiveContext } from '../../utils/with-hive-context.js';
import { JiraClient } from './client.js';
import { createSubtask, postComment } from './comments.js';
import { getIssue } from './issues.js';
import { syncRequirementToJira, tryMoveToActiveSprint } from './stories.js';
import { transitionJiraIssue } from './transitions.js';
export { isForwardTransition };

/**
 * Callback type for short-lived database access.
 * In production, each call acquires and releases the DB lock.
 * In tests, this can be a simple pass-through to an in-memory DB.
 */
export type WithDb = <T>(fn: (db: Database) => T | Promise<T>) => Promise<T>;

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
 * Create a JiraClient from environment variables.
 * Shared by all sync functions in this module.
 */
function createJiraClient(tokenStore: TokenStore): JiraClient {
  loadEnvIntoProcess();
  return new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });
}

/**
 * Shared loop used by both bidirectional sync functions.
 *
 * For each story, fetches the current Jira status, converts it to a Hive status
 * via the configured mapping, skips if unmapped, then delegates to `onMappedStatus`
 * for the direction-specific action. Catches and logs per-story errors so one
 * failing story does not abort the entire batch.
 *
 * Note: This function does NOT hold a DB lock. Error log entries are collected
 * and returned for the caller to write in a short-lived DB session.
 *
 * @param client - Authenticated JiraClient
 * @param config - Jira configuration with status_mapping
 * @param stories - Stories to process
 * @param getIssueKey - Returns the Jira issue key for a given story row
 * @param onMappedStatus - Called when a Jira status is successfully mapped;
 *   returns true if the story was acted upon (counted toward the return value)
 * @returns Count and collected error log entries
 */
async function processBidirectionalStatusSync(
  client: JiraClient,
  config: JiraConfig,
  stories: StoryRow[],
  getIssueKey: (story: StoryRow) => string,
  onMappedStatus: (
    story: StoryRow,
    issueKey: string,
    jiraStatusName: string,
    mappedHiveStatus: string
  ) => Promise<boolean>
): Promise<{ count: number; errorLogs: Array<{ storyId: string; issueKey: string; message: string }> }> {
  let count = 0;
  const errorLogs: Array<{ storyId: string; issueKey: string; message: string }> = [];
  for (const story of stories) {
    const issueKey = getIssueKey(story);
    try {
      const jiraIssue = await getIssue(client, issueKey, ['status']);
      const jiraStatusName = jiraIssue.fields.status.name;
      const mappedHiveStatus = jiraStatusToHiveStatus(jiraStatusName, config.status_mapping);
      if (!mappedHiveStatus) {
        logger.debug(
          `No Hive status mapping for Jira status "${jiraStatusName}" (${issueKey}), skipping`
        );
        continue;
      }
      if (await onMappedStatus(story, issueKey, jiraStatusName, mappedHiveStatus)) {
        count++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to sync Jira status for story ${story.id} (${issueKey}): ${message}`);
      errorLogs.push({ storyId: story.id, issueKey, message });
    }
  }
  return { count, errorLogs };
}

/**
 * Sync Jira issue statuses back to the Hive database.
 * This detects manual status changes in Jira (e.g., dragging cards on the board)
 * and updates the corresponding stories in the Hive database.
 *
 * Uses a read-call-write pattern: reads stories (short lock), fetches Jira
 * statuses (no lock), then writes updates (short lock).
 *
 * @param withDb - Callback for short-lived database access
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration with status_mapping
 * @returns Number of stories updated
 */
export async function syncJiraStatusesToHive(
  withDb: WithDb,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Skip if no status mapping configured
  if (!config.status_mapping || Object.keys(config.status_mapping).length === 0) {
    logger.debug('No Jira status mapping configured, skipping bidirectional sync');
    return 0;
  }

  // --- Read phase (short lock) ---
  const storiesWithJira = await withDb(db =>
    queryAll<StoryRow>(
      db,
      `SELECT * FROM stories WHERE external_issue_key IS NOT NULL AND status NOT IN ('merged')`
    )
  );

  if (storiesWithJira.length === 0) {
    return 0;
  }

  // --- API phase (no lock) ---
  const client = createJiraClient(tokenStore);

  interface StatusUpdate {
    storyId: string;
    mappedHiveStatus: string;
    oldStatus: string;
    jiraStatusName: string;
    jiraKey: string;
  }

  const updates: StatusUpdate[] = [];

  const { errorLogs } = await processBidirectionalStatusSync(
    client,
    config,
    storiesWithJira,
    story => story.external_issue_key!,
    async (story, issueKey, jiraStatusName, mappedHiveStatus) => {
      // Guard: never regress status backward in the lifecycle
      if (isStatusRegression(story.status, mappedHiveStatus)) {
        logger.debug(
          `Skipping Jira sync for ${story.id}: would regress ${story.status} → ${mappedHiveStatus}`
        );
        return false;
      }

      if (mappedHiveStatus === story.status) return false;

      // Only allow forward transitions — never regress stories backward
      if (!isForwardTransition(story.status, mappedHiveStatus)) {
        logger.debug(
          `Skipping backward Jira sync for story ${story.id} (${issueKey}): ` +
            `would regress ${story.status} → ${mappedHiveStatus} (Jira: "${jiraStatusName}")`
        );
        return false;
      }

      updates.push({
        storyId: story.id,
        mappedHiveStatus,
        oldStatus: story.status,
        jiraStatusName,
        jiraKey: issueKey,
      });

      logger.debug(
        `Synced Jira status for story ${story.id} (${issueKey}): ${story.status} → ${mappedHiveStatus}`
      );

      return true;
    }
  );

  // --- Write phase (short lock) ---
  if (updates.length > 0 || errorLogs.length > 0) {
    await withDb(db => {
      for (const update of updates) {
        withTransaction(db, () => {
          updateStory(db, update.storyId, { status: update.mappedHiveStatus as StoryStatus });

          createLog(db, {
            agentId: 'manager',
            storyId: update.storyId,
            eventType: 'JIRA_SYNC_COMPLETED',
            message: `Synced status from Jira: ${update.oldStatus} → ${update.mappedHiveStatus} (Jira: "${update.jiraStatusName}")`,
            metadata: {
              jiraKey: update.jiraKey,
              oldHiveStatus: update.oldStatus,
              newHiveStatus: update.mappedHiveStatus,
              jiraStatus: update.jiraStatusName,
            },
          });
        });
      }

      for (const err of errorLogs) {
        createLog(db, {
          agentId: 'manager',
          storyId: err.storyId,
          eventType: 'JIRA_SYNC_WARNING',
          status: 'warn',
          message: `Failed to sync status: ${err.message}`,
          metadata: { jiraKey: err.issueKey, error: err.message },
        });
      }
    });
  }

  return updates.length;
}

/**
 * Detect stories that exist in the Hive DB but have no Jira issue key,
 * and sync them to Jira by creating issues under the requirement's epic.
 *
 * This catches stories inserted directly into the DB (e.g., by the tech lead
 * via SQL) that bypassed the normal sync flow.
 *
 * Uses withDb for each requirement group so the lock is held per-group
 * rather than for the entire sync operation.
 *
 * @param withDb - Callback for short-lived database access
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration
 * @returns Number of stories synced to Jira
 */
export async function syncUnsyncedStoriesToJira(
  withDb: WithDb,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // --- Read phase (short lock) ---
  interface RequirementGroup {
    requirement: RequirementRow;
    confirmedStoryIds: string[];
    teamName: string | undefined;
  }

  const readData = await withDb(db => {
    // Find stories that have no external_issue_key but are not in draft status
    const unsyncedStories = queryAll<StoryRow>(
      db,
      `SELECT * FROM stories WHERE external_issue_key IS NULL AND status NOT IN ('draft') ORDER BY requirement_id, id`
    );

    if (unsyncedStories.length === 0) {
      return null;
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

    const groups: RequirementGroup[] = [];

    for (const [requirementId, stories] of byRequirement) {
      if (!requirementId) {
        logger.warn(`Skipping ${stories.length} unsynced stories with no requirement_id`);
        continue;
      }

      const requirement = queryOne<RequirementRow>(
        db,
        `SELECT * FROM requirements WHERE id = ?`,
        [requirementId]
      );

      if (!requirement) {
        logger.warn(`Requirement ${requirementId} not found, skipping ${stories.length} stories`);
        continue;
      }

      // Get the team name from the first story's team_id
      const teamName = stories[0].team_id ?? undefined;

      // Re-query guard: double-check each story still has no jira_issue_key
      const confirmedStoryIds: string[] = [];
      for (const s of stories) {
        const fresh = getStoryById(db, s.id);
        if (fresh && !fresh.jira_issue_key) {
          confirmedStoryIds.push(s.id);
        } else {
          logger.debug(`Story ${s.id} now has Jira key, skipping re-sync`);
        }
      }

      if (confirmedStoryIds.length > 0) {
        groups.push({ requirement, confirmedStoryIds, teamName });
      }
    }

    return groups;
  });

  if (!readData || readData.length === 0) {
    return 0;
  }

  // --- API + DB phase per requirement group (short lock per group) ---
  let syncedCount = 0;

  for (const group of readData) {
    try {
      const result = await withDb(db =>
        syncRequirementToJira(
          db,
          tokenStore,
          config,
          group.requirement,
          group.confirmedStoryIds,
          group.teamName
        )
      );

      syncedCount += result.stories.length;

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          logger.warn(`Jira sync error: ${err}`);
        }
      }

      if (result.stories.length > 0) {
        logger.info(
          `Synced ${result.stories.length} story(ies) to Jira for requirement ${group.requirement.id} (epic: ${result.epicKey})`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to sync stories for requirement ${group.requirement.id}: ${message}`);
    }
  }

  return syncedCount;
}

/**
 * Detect stories that were assigned to agents but missed the Jira
 * assignment hook (subtask creation + status transition).
 *
 * Uses a read-call-write pattern: reads stories and agent info (short lock),
 * makes API calls per story (no lock), then writes results (short lock per story).
 *
 * @param withDb - Callback for short-lived database access
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration
 * @returns Number of stories repaired
 */
export async function repairMissedAssignmentHooks(
  withDb: WithDb,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // --- Read phase (short lock) ---
  const storiesToRepair = await withDb(db => {
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
      return null;
    }

    logger.info(
      `Found ${storiesMissingSubtasks.length} assigned story(ies) missing Jira subtasks — repairing`
    );

    return storiesMissingSubtasks.map(story => {
      const agent = getAgentById(db, story.assigned_agent_id!);
      const agentName = agent?.tmux_session || agent?.id || story.assigned_agent_id!;
      return { story, agentName };
    });
  });

  if (!storiesToRepair || storiesToRepair.length === 0) {
    return 0;
  }

  // --- API + write phase per story ---
  const client = createJiraClient(tokenStore);

  let repairedCount = 0;

  for (const { story, agentName } of storiesToRepair) {
    try {
      // API call: create the subtask (no lock)
      const subtask = await createSubtask(client, {
        parentIssueKey: story.external_issue_key!,
        projectKey: story.external_project_key || config.project_key,
        agentName,
        storyTitle: story.title,
      });

      if (subtask) {
        // API call: post "assigned" comment (no lock)
        await postComment(client, story.external_issue_key!, 'assigned', {
          agentName,
          subtaskKey: subtask.key,
        });

        // Write phase (short lock)
        await withDb(db => {
          updateStory(db, story.id, {
            externalSubtaskKey: subtask.key,
            externalSubtaskId: subtask.id,
          });

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
        });

        logger.info(
          `Repaired: created Jira subtask ${subtask.key} for story ${story.id} (agent: ${agentName})`
        );

        repairedCount++;
      }

      // API call: transition Jira issue to match story status (no lock)
      if (story.status !== 'planned' && story.status !== 'draft') {
        if (config.status_mapping && Object.keys(config.status_mapping).length > 0) {
          try {
            const transitioned = await transitionJiraIssue(
              client,
              story.external_issue_key!,
              story.status,
              config.status_mapping
            );
            if (transitioned) {
              await withDb(db => {
                createLog(db, {
                  agentId: 'manager',
                  storyId: story.id,
                  eventType: 'JIRA_TRANSITION_SUCCESS',
                  message: `Transitioned Jira issue ${story.external_issue_key} for status change to "${story.status}"`,
                  metadata: {
                    jiraKey: story.external_issue_key,
                    hiveStatus: story.status,
                  },
                });
              });
            }
          } catch (transErr) {
            const transMsg = transErr instanceof Error ? transErr.message : String(transErr);
            logger.warn(
              `Failed to transition Jira issue ${story.external_issue_key} for story ${story.id}: ${transMsg}`
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to repair assignment hook for story ${story.id}: ${message}`);

      await withDb(db => {
        createLog(db, {
          agentId: 'manager',
          storyId: story.id,
          eventType: 'JIRA_ASSIGNMENT_REPAIR_FAILED',
          status: 'warn',
          message: `Failed to repair missed assignment hook: ${message}`,
          metadata: { jiraKey: story.external_issue_key, error: message },
        });
      });
    }
  }

  return repairedCount;
}

/**
 * Retry sprint assignment for stories that have a Jira issue key
 * but were not successfully moved to the active sprint.
 *
 * Uses a read-call-write pattern: reads stories (short lock), makes API
 * call (no lock), then writes results (short lock).
 *
 * @param withDb - Callback for short-lived database access
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration
 * @returns Number of stories moved to sprint
 */
export async function retrySprintAssignment(
  withDb: WithDb,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // --- Read phase (short lock) ---
  const storiesNotInSprint = await withDb(db =>
    queryAll<StoryRow>(
      db,
      `SELECT * FROM stories
       WHERE jira_issue_key IS NOT NULL
         AND (in_sprint IS NULL OR in_sprint = 0)
         AND status NOT IN ('merged')
       ORDER BY created_at`
    )
  );

  if (storiesNotInSprint.length === 0) {
    return 0;
  }

  // --- API phase (no lock) ---
  logger.info(`Found ${storiesNotInSprint.length} story(ies) not in sprint — retrying assignment`);

  const client = createJiraClient(tokenStore);

  const issueKeys = storiesNotInSprint.map(s => s.jira_issue_key!).filter(Boolean);

  const moved = await tryMoveToActiveSprint(client, config, issueKeys);

  // --- Write phase (short lock) ---
  if (moved) {
    await withDb(db => {
      for (const story of storiesNotInSprint) {
        updateStory(db, story.id, { inSprint: true });
      }
    });
    return storiesNotInSprint.length;
  }

  return 0;
}

/**
 * Push Hive story status changes TO Jira.
 * This detects stories whose Hive status has advanced beyond their Jira status
 * and pushes the updated status to Jira.
 *
 * Uses a read-call-write pattern: reads stories (short lock), fetches and
 * transitions Jira statuses (no lock), then writes logs (short lock).
 *
 * @param withDb - Callback for short-lived database access
 * @param tokenStore - Token store for Jira API auth
 * @param config - Jira configuration with status_mapping
 * @returns Number of stories pushed to Jira
 */
export async function syncHiveStatusesToJira(
  withDb: WithDb,
  tokenStore: TokenStore,
  config: JiraConfig
): Promise<number> {
  // Skip if no status mapping configured
  if (!config.status_mapping || Object.keys(config.status_mapping).length === 0) {
    logger.debug('No Jira status mapping configured, skipping Hive-to-Jira sync');
    return 0;
  }

  // --- Read phase (short lock) ---
  const storiesWithJira = await withDb(db =>
    queryAll<StoryRow>(
      db,
      `SELECT * FROM stories WHERE jira_issue_key IS NOT NULL AND status NOT IN ('merged')`
    )
  );

  if (storiesWithJira.length === 0) {
    return 0;
  }

  // --- API phase (no lock) ---
  const client = createJiraClient(tokenStore);

  interface LogEntry {
    storyId: string;
    eventType: EventType;
    status?: string;
    message: string;
    metadata: Record<string, unknown>;
  }

  const logEntries: LogEntry[] = [];

  const { count: pushedCount, errorLogs } = await processBidirectionalStatusSync(
    client,
    config,
    storiesWithJira,
    story => story.jira_issue_key!,
    async (story, issueKey, jiraStatusName, jiraStatusAsHiveStatus) => {
      if (story.status === jiraStatusAsHiveStatus) return false;

      // Only push forward transitions — never regress Jira backward
      if (!isForwardTransition(jiraStatusAsHiveStatus, story.status)) {
        logger.debug(
          `Skipping Hive-to-Jira push for story ${story.id} (${issueKey}): ` +
            `would regress Jira from ${jiraStatusAsHiveStatus} → ${story.status} (Jira: "${jiraStatusName}")`
        );
        return false;
      }

      // Push the Hive status to Jira
      const transitioned = await transitionJiraIssue(
        client,
        issueKey,
        story.status,
        config.status_mapping
      );

      if (transitioned) {
        logEntries.push({
          storyId: story.id,
          eventType: 'JIRA_SYNC_COMPLETED',
          message: `Pushed status to Jira: ${jiraStatusAsHiveStatus} → ${story.status} (was Jira: "${jiraStatusName}")`,
          metadata: {
            jiraKey: issueKey,
            oldJiraStatus: jiraStatusName,
            oldHiveStatus: jiraStatusAsHiveStatus,
            newHiveStatus: story.status,
          },
        });

        logger.debug(
          `Pushed Hive status to Jira for story ${story.id} (${issueKey}): ${jiraStatusAsHiveStatus} → ${story.status}`
        );
      }

      return transitioned;
    }
  );

  // --- Write phase (short lock) ---
  if (logEntries.length > 0 || errorLogs.length > 0) {
    await withDb(db => {
      for (const entry of logEntries) {
        createLog(db, {
          agentId: 'manager',
          storyId: entry.storyId,
          eventType: entry.eventType,
          status: entry.status,
          message: entry.message,
          metadata: entry.metadata,
        });
      }

      for (const err of errorLogs) {
        createLog(db, {
          agentId: 'manager',
          storyId: err.storyId,
          eventType: 'JIRA_SYNC_WARNING',
          status: 'warn',
          message: `Failed to sync status: ${err.message}`,
          metadata: { jiraKey: err.issueKey, error: err.message },
        });
      }
    });
  }

  return pushedCount;
}

/**
 * Top-level entry point for Jira bidirectional sync.
 *
 * Loads config and tokens from the hive root directory, checks if Jira
 * integration is enabled, and:
 * 1. Syncs unsynced stories TO Jira (creates missing Jira issues)
 * 2. Repairs missed Jira assignment hooks
 * 3. Retries sprint assignment for stories that failed
 * 4. Syncs Jira statuses back to Hive (bidirectional status sync)
 * 5. Pushes Hive status changes TO Jira (periodic status push)
 *
 * Each sub-operation acquires and releases the DB lock independently,
 * so API calls do not block other processes from accessing the database.
 *
 * Never throws — all errors are caught and logged.
 *
 * @param root - Hive root directory
 * @returns Number of stories updated (from bidirectional status sync)
 */
export async function syncFromJira(root: string): Promise<number> {
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

    // Create a withDb callback that acquires a short-lived DB lock per call
    const withDb: WithDb = async fn => {
      return withHiveContext(async ({ db }) => {
        const result = await fn(db.db);
        db.save();
        return result;
      });
    };

    // First: push any unsynced stories TO Jira
    await syncUnsyncedStoriesToJira(withDb, tokenStore, jiraConfig);

    // Then: repair any assigned stories that missed the Jira assignment hook
    await repairMissedAssignmentHooks(withDb, tokenStore, jiraConfig);

    // Retry sprint assignment for stories that failed to move into a sprint
    await retrySprintAssignment(withDb, tokenStore, jiraConfig);

    // Next: pull status updates FROM Jira
    const pulledCount = await syncJiraStatusesToHive(withDb, tokenStore, jiraConfig);

    // Finally: push Hive status updates TO Jira
    await syncHiveStatusesToJira(withDb, tokenStore, jiraConfig);

    return pulledCount;
  } catch (err) {
    // Never block the pipeline — log and continue
    logger.debug(`Failed to sync from Jira: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
