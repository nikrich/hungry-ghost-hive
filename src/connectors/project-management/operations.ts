// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Provider-agnostic high-level operations for project management.
 *
 * These functions replace direct Jira/provider imports in core modules.
 * Each function loads config, resolves the active PM connector, and delegates
 * to the appropriate provider implementation. All functions are safe to call
 * even when no PM provider is configured — they silently return in that case.
 */

import { join } from 'path';
import type Database from 'better-sqlite3';
// @ts-ignore Database.Database type;
import type { HiveConfig } from '../../config/schema.js';
import { queryOne } from '../../db/client.js';
import type { StoryRow } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import type {
  ConnectorCommentContext,
  ConnectorCreateSubtaskOptions,
  ConnectorLifecycleEvent,
  ConnectorSubtaskResult,
} from '../common-types.js';
import { registry } from '../registry.js';
import type { IProjectManagementConnector } from './types.js';

/**
 * Ensure the PM connector for the given provider is registered and return it.
 * Uses dynamic import to load the provider's registration module.
 */
async function getConnector(provider: string): Promise<IProjectManagementConnector | null> {
  let connector = registry.getProjectManagement(provider);
  if (connector) return connector;

  // Lazily register the connector
  if (provider === 'jira') {
    const { register } = await import('./jira.js');
    register();
  }

  connector = registry.getProjectManagement(provider);
  return connector;
}

/**
 * Load config and resolve the active PM provider.
 * Returns null if no PM provider is configured.
 */
async function resolveProvider(root: string) {
  const { loadConfig } = await import('../../config/loader.js');
  const { getHivePaths } = await import('../../utils/paths.js');

  const paths = getHivePaths(root);
  const config = loadConfig(paths.hiveDir);
  const pmConfig = config.integrations.project_management;

  if (!pmConfig || pmConfig.provider === 'none') {
    return null;
  }

  const connector = await getConnector(pmConfig.provider);
  if (!connector) {
    logger.debug(`No connector registered for PM provider "${pmConfig.provider}"`);
    return null;
  }

  return { connector, config, paths, pmConfig };
}

/**
 * Sync a story's status change to the PM provider.
 * Replaces direct `syncStatusToJira()` calls.
 *
 * Never throws — failures are logged as debug messages.
 */
export async function syncStatusForStory(
  root: string,
  db: Database.Database,
  storyId: string,
  newStatus: string
): Promise<void> {
  try {
    // Delegate to the provider-specific sync function via dynamic import.
    // This preserves the full logging and DB interaction logic in the integration module.
    const resolved = await resolveProvider(root);
    if (!resolved) return;

    const { pmConfig } = resolved;

    if (pmConfig.provider === 'jira') {
      const { syncStatusToJira } = await import('../../integrations/jira/transitions.js');
      await syncStatusToJira(root, db, storyId, newStatus);
    }
  } catch (err) {
    logger.debug(
      `Failed to sync status for story ${storyId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Post a lifecycle comment on a story's PM issue.
 * Replaces direct `postJiraLifecycleComment()` calls.
 *
 * Never throws — failures are logged as warnings.
 */
export async function postLifecycleComment(
  db: Database.Database,
  _hiveDir: string,
  hiveConfig: HiveConfig | undefined,
  storyId: string,
  event: ConnectorLifecycleEvent,
  context: ConnectorCommentContext = {}
): Promise<void> {
  try {
    if (!hiveConfig) return;
    const pmConfig = hiveConfig.integrations?.project_management;
    if (!pmConfig || pmConfig.provider === 'none') return;

    const story = queryOne<StoryRow>(db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
    if (!story || !story.external_issue_key) {
      logger.debug(`Story ${storyId} has no external issue key, skipping ${event} comment`);
      return;
    }

    const connector = await getConnector(pmConfig.provider);
    if (!connector) return;

    await connector.postComment(story.external_issue_key, event, context);
  } catch (err) {
    logger.warn(
      `Failed to post ${event} comment for story ${storyId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Post a progress update to a story's subtask in the PM provider.
 * Replaces direct `postProgressToSubtask()` calls.
 *
 * Never throws — failures are logged as warnings.
 */
export async function postProgressUpdate(
  db: Database.Database,
  _hiveDir: string,
  hiveConfig: HiveConfig | undefined,
  storyId: string,
  progressMessage: string,
  agentName?: string
): Promise<void> {
  try {
    if (!hiveConfig) return;
    const pmConfig = hiveConfig.integrations?.project_management;
    if (!pmConfig || pmConfig.provider === 'none') return;

    const story = queryOne<StoryRow>(db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
    if (!story?.external_subtask_key) {
      logger.debug(`Story ${storyId} has no external subtask, skipping progress update`);
      return;
    }

    const connector = await getConnector(pmConfig.provider);
    if (!connector) return;

    await connector.postComment(story.external_subtask_key, 'progress', {
      agentName,
      reason: progressMessage,
    });

    await connector.transitionSubtask(story.external_subtask_key, 'In Progress');
  } catch (err) {
    logger.warn(
      `Failed to post progress to subtask for story ${storyId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Run bidirectional sync with the PM provider.
 * Replaces direct `syncFromJira()` calls.
 *
 * Never throws — failures are logged.
 */
export async function syncFromProvider(root: string, db: Database.Database): Promise<number> {
  try {
    const resolved = await resolveProvider(root);
    if (!resolved) return 0;

    const { pmConfig } = resolved;

    if (pmConfig.provider === 'jira') {
      const { syncFromJira } = await import('../../integrations/jira/sync.js');
      return syncFromJira(root, db);
    }

    return 0;
  } catch (err) {
    logger.debug(
      `Failed to sync from provider: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}

/**
 * Sync a single story to the PM provider.
 * Replaces direct `syncStoryToJira()` calls.
 */
export async function syncStoryToProvider(
  root: string,
  db: Database.Database,
  story: StoryRow,
  teamName?: string
): Promise<{ key: string; id: string } | null> {
  const resolved = await resolveProvider(root);
  if (!resolved) return null;

  const { pmConfig, paths } = resolved;

  if (pmConfig.provider === 'jira' && pmConfig.jira) {
    const { TokenStore } = await import('../../auth/token-store.js');
    const { syncStoryToJira } = await import('../../integrations/jira/stories.js');

    const envPath = join(paths.hiveDir, '.env');
    const tokenStore = new TokenStore(envPath);
    await tokenStore.loadFromEnv(envPath);

    const result = await syncStoryToJira(db, tokenStore, pmConfig.jira, story, teamName);
    if (!result) return null;
    return { key: result.jiraKey, id: result.jiraId };
  }

  return null;
}

/**
 * Sync a requirement and its stories to the PM provider.
 * Replaces direct `syncRequirementToJira()` calls.
 */
export async function syncRequirementToProvider(
  root: string,
  db: Database.Database,
  requirement: { id: string; title: string; description: string },
  storyIds: string[],
  teamName?: string
): Promise<{
  epicKey: string | null;
  stories: Array<{ storyId: string; key: string; id: string }>;
  errors: string[];
}> {
  const emptyResult = { epicKey: null, stories: [], errors: [] };

  const resolved = await resolveProvider(root);
  if (!resolved) return emptyResult;

  const { pmConfig, paths } = resolved;

  if (pmConfig.provider === 'jira' && pmConfig.jira) {
    const { TokenStore } = await import('../../auth/token-store.js');
    const { syncRequirementToJira } = await import('../../integrations/jira/stories.js');

    const envPath = join(paths.hiveDir, '.env');
    const tokenStore = new TokenStore(envPath);
    await tokenStore.loadFromEnv(envPath);

    const result = await syncRequirementToJira(
      db,
      tokenStore,
      pmConfig.jira,
      requirement as any,
      storyIds,
      teamName
    );

    return {
      epicKey: result.epicKey,
      stories: result.stories.map(s => ({ storyId: s.storyId, key: s.jiraKey, id: s.jiraId })),
      errors: result.errors,
    };
  }

  return emptyResult;
}

/**
 * Create a subtask for an assigned agent on a story's PM issue.
 * Replaces direct JiraClient + createSubtask() calls.
 *
 * Never throws — returns null on failure.
 */
export async function createSubtaskForStory(
  root: string,
  _issueKey: string,
  options: ConnectorCreateSubtaskOptions
): Promise<ConnectorSubtaskResult | null> {
  try {
    const resolved = await resolveProvider(root);
    if (!resolved) return null;

    return resolved.connector.createSubtask(options);
  } catch (err) {
    logger.warn(
      `Failed to create subtask for ${options.agentName}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Post a comment on a PM issue.
 * Replaces direct JiraClient + postComment() calls.
 */
export async function postCommentOnIssue(
  root: string,
  issueKey: string,
  event: ConnectorLifecycleEvent,
  context: ConnectorCommentContext = {}
): Promise<boolean> {
  try {
    const resolved = await resolveProvider(root);
    if (!resolved) return false;

    return resolved.connector.postComment(issueKey, event, context);
  } catch (err) {
    logger.warn(
      `Failed to post ${event} comment on ${issueKey}: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

/**
 * Transition a subtask to a target status.
 * Replaces direct JiraClient + transitionSubtask() calls.
 */
export async function transitionSubtaskStatus(
  root: string,
  subtaskKey: string,
  targetStatus: string
): Promise<boolean> {
  try {
    const resolved = await resolveProvider(root);
    if (!resolved) return false;

    return resolved.connector.transitionSubtask(subtaskKey, targetStatus);
  } catch (err) {
    logger.warn(
      `Failed to transition subtask ${subtaskKey}: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}
