// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
import { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import { queryAll } from '../../db/client.js';
import { createSyncRecord } from '../../db/queries/integration-sync.js';
import { createLog } from '../../db/queries/logs.js';
import {
  createRequirement,
  updateRequirement,
  type RequirementRow,
} from '../../db/queries/requirements.js';
import * as logger from '../../utils/logger.js';
import { JiraClient } from './client.js';
import { searchJql } from './issues.js';
import type { AdfDocument, AdfNode, JiraIssue } from './types.js';

/** Result of a board poll cycle */
export interface BoardPollResult {
  /** Number of new epics ingested */
  ingestedCount: number;
  /** Requirement IDs created */
  requirements: Array<{
    requirementId: string;
    epicKey: string;
    epicId: string;
    title: string;
  }>;
  /** Errors encountered during polling */
  errors: string[];
}

/**
 * Extract plain text from an Atlassian Document Format (ADF) document.
 * Recursively walks the node tree and concatenates text content.
 */
export function adfToPlainText(doc: AdfDocument | null | undefined): string {
  if (!doc || !doc.content) return '';

  function extractText(nodes: AdfNode[]): string {
    const parts: string[] = [];

    for (const node of nodes) {
      if (node.type === 'text' && node.text) {
        parts.push(node.text);
      } else if (node.content) {
        parts.push(extractText(node.content));
      }

      // Add newline after block-level nodes
      if (
        node.type === 'paragraph' ||
        node.type === 'heading' ||
        node.type === 'bulletList' ||
        node.type === 'orderedList' ||
        node.type === 'listItem'
      ) {
        parts.push('\n');
      }
    }

    return parts.join('');
  }

  return extractText(doc.content).trim();
}

/**
 * Get all Jira epic keys that have already been synced as requirements.
 * Queries the requirements table for non-null jira_epic_key values.
 */
function getAlreadySyncedEpicKeys(db: Database): string[] {
  const rows = queryAll<Pick<RequirementRow, 'jira_epic_key'>>(
    db,
    "SELECT jira_epic_key FROM requirements WHERE jira_epic_key IS NOT NULL AND jira_epic_key != ''"
  );
  return rows.map(r => r.jira_epic_key!);
}

/**
 * Build the JQL query for finding unsynced epics on the board.
 */
function buildEpicSearchJql(projectKey: string, syncedKeys: string[]): string {
  let jql = `project = ${projectKey} AND issuetype = Epic AND status != Done`;

  if (syncedKeys.length > 0) {
    const keyList = syncedKeys.map(k => `"${k}"`).join(', ');
    jql += ` AND key NOT IN (${keyList})`;
  }

  jql += ' ORDER BY created ASC';
  return jql;
}

/**
 * Poll the configured Jira board for new epics and ingest them as Hive requirements.
 *
 * This function:
 * 1. Queries the integration_sync / requirements tables for already-synced epic keys
 * 2. Searches Jira for epics not yet ingested using JQL
 * 3. Creates a Hive requirement for each new epic
 * 4. Sets jira_epic_key and jira_epic_id on the requirement
 * 5. Records the sync in the integration_sync table
 * 6. Logs all ingestion events to agent_logs
 *
 * @param db - Database instance
 * @param hiveDir - Path to the .hive directory
 * @param config - Jira configuration
 * @returns Poll result with ingested count, requirement IDs, and any errors
 */
export async function pollBoardForEpics(
  db: Database,
  hiveDir: string,
  config: JiraConfig
): Promise<BoardPollResult> {
  const result: BoardPollResult = {
    ingestedCount: 0,
    requirements: [],
    errors: [],
  };

  // Log poll start
  createLog(db, {
    agentId: 'manager',
    eventType: 'JIRA_BOARD_POLL_STARTED',
    message: `Starting Jira board poll for project ${config.project_key}`,
    metadata: { project_key: config.project_key, board_id: config.board_id },
  });

  // Set up Jira client
  const tokenStore = new TokenStore(join(hiveDir, '.env'));
  await tokenStore.loadFromEnv();

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  // Get already-synced epic keys
  const syncedKeys = getAlreadySyncedEpicKeys(db);

  // Build JQL and search with pagination
  const jql = buildEpicSearchJql(config.project_key, syncedKeys);
  logger.debug(`Board watcher JQL: ${jql}`);

  let startAt = 0;
  const maxResults = 50;
  let hasMore = true;

  while (hasMore) {
    let searchResponse;
    try {
      searchResponse = await searchJql(client, jql, {
        startAt,
        maxResults,
        fields: ['summary', 'description', 'status', 'issuetype', 'labels', 'project', 'created'],
      });
    } catch (err) {
      const msg = `Failed to search Jira for epics: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      logger.error(msg);
      break;
    }

    const issues = searchResponse.issues;

    for (const epic of issues) {
      try {
        const ingested = ingestEpicAsRequirement(db, epic);
        result.requirements.push({
          requirementId: ingested.id,
          epicKey: epic.key,
          epicId: epic.id,
          title: epic.fields.summary,
        });
        result.ingestedCount++;
      } catch (err) {
        const msg = `Failed to ingest epic ${epic.key}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
        logger.warn(msg);
      }
    }

    // Check if there are more pages
    startAt += issues.length;
    hasMore = startAt < searchResponse.total && issues.length > 0;
  }

  // Log poll completion
  createLog(db, {
    agentId: 'manager',
    eventType: 'JIRA_BOARD_POLL_COMPLETED',
    message: `Board poll complete: ${result.ingestedCount} epics ingested, ${result.errors.length} errors`,
    metadata: {
      project_key: config.project_key,
      ingested_count: result.ingestedCount,
      error_count: result.errors.length,
      requirement_ids: result.requirements.map(r => r.requirementId),
    },
  });

  if (result.ingestedCount > 0) {
    logger.info(
      `Board watcher: ingested ${result.ingestedCount} new epic(s) from ${config.project_key}`
    );
  } else {
    logger.debug(`Board watcher: no new epics found in ${config.project_key}`);
  }

  return result;
}

/**
 * Ingest a single Jira epic as a Hive requirement.
 * Creates the requirement, sets Jira fields, records sync, and logs the event.
 */
function ingestEpicAsRequirement(db: Database, epic: JiraIssue): RequirementRow {
  const title = epic.fields.summary;
  const description = adfToPlainText(epic.fields.description) || title;

  // Create the Hive requirement
  const requirement = createRequirement(db, {
    title,
    description,
    submittedBy: 'jira-board-watcher',
  });

  // Set Jira epic key and ID on the requirement
  updateRequirement(db, requirement.id, {
    jiraEpicKey: epic.key,
    jiraEpicId: epic.id,
  });

  // Record sync in integration_sync table
  createSyncRecord(db, {
    entityType: 'requirement',
    entityId: requirement.id,
    provider: 'jira',
    externalId: epic.id,
  });

  // Log the ingestion event
  createLog(db, {
    agentId: 'manager',
    eventType: 'JIRA_EPIC_INGESTED',
    message: `Ingested Jira epic ${epic.key} as requirement ${requirement.id}`,
    metadata: {
      epic_key: epic.key,
      epic_id: epic.id,
      requirement_id: requirement.id,
      title,
    },
  });

  logger.info(`Ingested epic ${epic.key} ("${title}") as requirement ${requirement.id}`);

  return requirement;
}
