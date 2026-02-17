// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type Database from 'better-sqlite3';
import { loadEnvIntoProcess } from '../../auth/env-store.js';
import type { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import type { StoryRow } from '../../db/client.js';
import { createSyncRecord, getSyncRecordByEntity } from '../../db/queries/integration-sync.js';
import { updateRequirement, type RequirementRow } from '../../db/queries/requirements.js';
import { getStoryById, getStoryDependencies, updateStory } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { JiraClient } from './client.js';
import { createIssue, createIssueLink } from './issues.js';
import { getActiveSprintForProject, moveIssuesToSprint } from './sprints.js';
import type { AdfDocument, AdfNode, CreateIssueResponse } from './types.js';

/** Result of syncing a requirement and its stories to Jira */
export interface JiraSyncResult {
  epicKey: string | null;
  epicId: string | null;
  stories: Array<{
    storyId: string;
    jiraKey: string;
    jiraId: string;
  }>;
  errors: string[];
}

/**
 * Convert plain text to Atlassian Document Format (ADF).
 * Splits on double newlines for paragraphs.
 */
function textToAdf(text: string): AdfDocument {
  if (!text) {
    return {
      version: 1,
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
    };
  }

  const paragraphs = text.split(/\n\n+/);
  const content: AdfNode[] = paragraphs.map(para => ({
    type: 'paragraph',
    content: [{ type: 'text', text: para.trim() }],
  }));

  return { version: 1, type: 'doc', content };
}

/**
 * Convert description + acceptance criteria to ADF with a bulleted list.
 */
function acceptanceCriteriaToAdf(description: string, criteria: string[]): AdfDocument {
  const content: AdfNode[] = [
    { type: 'paragraph', content: [{ type: 'text', text: description }] },
  ];

  if (criteria.length > 0) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Acceptance Criteria:', marks: [{ type: 'strong' }] }],
    });
    content.push({
      type: 'bulletList',
      content: criteria.map(c => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: c }] }],
      })),
    });
  }

  return { version: 1, type: 'doc', content };
}

/**
 * Safely parse acceptance_criteria JSON string.
 * Returns empty array if parsing fails or if result is not an array.
 * Exported for testing.
 */
export function safelyParseAcceptanceCriteria(
  acceptanceCriteriaJson: string | null,
  storyId: string
): string[] {
  if (!acceptanceCriteriaJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(acceptanceCriteriaJson);
    if (!Array.isArray(parsed)) {
      logger.warn(
        `acceptance_criteria for story ${storyId} is not an array, got: ${typeof parsed}`
      );
      return [];
    }
    return parsed as string[];
  } catch (err) {
    logger.warn(
      `Failed to parse acceptance_criteria for story ${storyId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/**
 * Build the description ADF for a story, including acceptance criteria if present.
 */
function buildStoryDescription(description: string, acceptanceCriteria: string[]): AdfDocument {
  if (acceptanceCriteria.length > 0) {
    return acceptanceCriteriaToAdf(description, acceptanceCriteria);
  }
  return textToAdf(description);
}

/**
 * Try to move issue keys into the active sprint for the project.
 * Returns true if issues were successfully moved, false otherwise.
 * Logs warnings on failure but never throws.
 */
export async function tryMoveToActiveSprint(
  client: JiraClient,
  config: JiraConfig,
  issueKeys: string[]
): Promise<boolean> {
  if (issueKeys.length === 0) return false;

  try {
    const preferredBoardId = config.board_id ? Number(config.board_id) : undefined;
    const sprintInfo = await getActiveSprintForProject(
      client,
      config.project_key,
      preferredBoardId
    );
    if (!sprintInfo) {
      logger.debug(
        `No active sprint found for project ${config.project_key}, skipping sprint assignment`
      );
      return false;
    }
    await moveIssuesToSprint(client, sprintInfo.sprint.id, issueKeys);
    logger.info(`Moved ${issueKeys.length} issue(s) to sprint "${sprintInfo.sprint.name}"`);
    return true;
  } catch (err) {
    logger.warn(
      `Failed to move issues to active sprint: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

/**
 * Sync a requirement and its stories to Jira.
 * If the requirement already has an external_epic_key (imported via URL), skips epic creation.
 * Otherwise creates a Jira Epic for the requirement.
 * Then creates Jira Stories under the epic, creates issue links for dependencies,
 * and moves stories to the active sprint.
 */
export async function syncRequirementToJira(
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig,
  requirement: RequirementRow,
  storyIds: string[],
  teamName?: string
): Promise<JiraSyncResult> {
  // Ensure Jira client credentials from .hive/.env are in process.env
  loadEnvIntoProcess();

  const result: JiraSyncResult = {
    epicKey: null,
    epicId: null,
    stories: [],
    errors: [],
  };

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  // Step 1: Resolve or create the Jira Epic
  const labels = ['hive-managed'];
  if (teamName) {
    labels.push(teamName);
  }

  let epicKey: string | null = null;

  if (requirement.external_epic_key && requirement.external_epic_id) {
    // Epic already exists (imported via URL) — reuse it
    epicKey = requirement.external_epic_key;
    result.epicKey = requirement.external_epic_key;
    result.epicId = requirement.external_epic_id;
  } else {
    // Create a new Jira Epic
    let epic: CreateIssueResponse | null = null;
    try {
      epic = await createIssue(client, {
        fields: {
          project: { key: config.project_key },
          summary: requirement.title,
          issuetype: { name: 'Epic' },
          description: textToAdf(requirement.description),
          labels,
        },
      });

      epicKey = epic.key;
      result.epicKey = epic.key;
      result.epicId = epic.id;

      // Update requirement with epic info (provider-agnostic)
      updateRequirement(db, requirement.id, {
        externalEpicKey: epic.key,
        externalEpicId: epic.id,
        externalProvider: 'jira',
      });

      // Record sync state
      createSyncRecord(db, {
        entityType: 'requirement',
        entityId: requirement.id,
        provider: 'jira',
        externalId: epic.id,
      });
    } catch (err) {
      const msg = `Failed to create Jira Epic for ${requirement.id}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
    }
  }

  // Step 2: Create Jira Stories under the epic
  const storyKeyMap: Record<string, string> = {};
  const createdStoryKeys: string[] = [];

  for (const storyId of storyIds) {
    const story = getStoryById(db, storyId);
    if (!story) {
      result.errors.push(`Story ${storyId} not found in local DB`);
      continue;
    }

    // Idempotency guard: skip if this story was already synced to Jira
    if (story.jira_issue_key) {
      logger.debug(`Story ${storyId} already has Jira key ${story.jira_issue_key}, skipping`);
      storyKeyMap[storyId] = story.jira_issue_key;
      continue;
    }
    const existingSync = getSyncRecordByEntity(db, 'story', storyId, 'jira');
    if (existingSync && existingSync.sync_status === 'synced') {
      logger.debug(`Story ${storyId} already has sync record, skipping Jira creation`);
      continue;
    }

    try {
      const acceptanceCriteria = safelyParseAcceptanceCriteria(story.acceptance_criteria, storyId);

      const storyLabels = ['hive-managed'];
      if (teamName) {
        storyLabels.push(teamName);
      }

      const fields: Record<string, unknown> = {
        project: { key: config.project_key },
        summary: story.title,
        issuetype: { name: config.story_type || 'Story' },
        description: buildStoryDescription(story.description, acceptanceCriteria),
        labels: storyLabels,
      };

      const points = story.story_points ?? story.complexity_score;
      if (points !== null && points !== undefined) {
        fields[config.story_points_field || 'story_points'] = points;
      }

      if (epicKey) {
        fields.parent = { key: epicKey };
      }

      const jiraStory = await createIssue(client, { fields } as any);

      // Update local story with external integration info
      updateStory(db, storyId, {
        externalIssueKey: jiraStory.key,
        externalIssueId: jiraStory.id,
        externalProjectKey: config.project_key,
        externalProvider: 'jira',
      });

      // Record sync state
      createSyncRecord(db, {
        entityType: 'story',
        entityId: storyId,
        provider: 'jira',
        externalId: jiraStory.id,
      });

      storyKeyMap[storyId] = jiraStory.key;
      createdStoryKeys.push(jiraStory.key);
      result.stories.push({
        storyId,
        jiraKey: jiraStory.key,
        jiraId: jiraStory.id,
      });
    } catch (err) {
      const msg = `Failed to create Jira Story for ${storyId}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
    }
  }

  // Step 3: Create issue links for story dependencies
  for (const storyId of storyIds) {
    const jiraKey = storyKeyMap[storyId];
    if (!jiraKey) continue;

    const dependencies = getStoryDependencies(db, storyId);
    for (const dep of dependencies) {
      const depJiraKey = storyKeyMap[dep.id];
      if (!depJiraKey) continue;

      try {
        await createIssueLink(client, {
          type: { name: 'Blocks' },
          inwardIssue: { key: jiraKey },
          outwardIssue: { key: depJiraKey },
        });
      } catch (err) {
        const msg = `Failed to create issue link ${jiraKey} -> ${depJiraKey}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
      }
    }
  }

  // Step 4: Move created stories to the active sprint
  const movedToSprint = await tryMoveToActiveSprint(client, config, createdStoryKeys);
  if (movedToSprint) {
    for (const { storyId } of result.stories) {
      updateStory(db, storyId, { inSprint: true });
    }
  }

  return result;
}

/**
 * Sync a single story to Jira (for use by CLI `hive stories create`).
 * If an epic already exists for the requirement, links the story to it.
 * Moves the story to the active sprint after creation.
 */
export async function syncStoryToJira(
  db: Database.Database,
  tokenStore: TokenStore,
  config: JiraConfig,
  story: StoryRow,
  teamName?: string
): Promise<{ jiraKey: string; jiraId: string } | null> {
  loadEnvIntoProcess();

  const client = new JiraClient({
    tokenStore,
    clientId: process.env.JIRA_CLIENT_ID || '',
    clientSecret: process.env.JIRA_CLIENT_SECRET || '',
  });

  // Find epic key from the requirement if available
  let epicKey: string | undefined;
  if (story.requirement_id) {
    const { getRequirementById } = await import('../../db/queries/requirements.js');
    const req = getRequirementById(db, story.requirement_id);
    if (req?.external_epic_key) {
      epicKey = req.external_epic_key;
    }
  }

  const acceptanceCriteria = safelyParseAcceptanceCriteria(story.acceptance_criteria, story.id);

  const labels = ['hive-managed'];
  if (teamName) {
    labels.push(teamName);
  }

  const fields: Record<string, unknown> = {
    project: { key: config.project_key },
    summary: story.title,
    issuetype: { name: config.story_type || 'Story' },
    description: buildStoryDescription(story.description, acceptanceCriteria),
    labels,
  };

  const points = story.story_points ?? story.complexity_score;
  if (points !== null && points !== undefined) {
    fields[config.story_points_field || 'story_points'] = points;
  }

  if (epicKey) {
    fields.parent = { key: epicKey };
  }

  const jiraStory = await createIssue(client, { fields } as any);

  // Update local story with external integration info
  updateStory(db, story.id, {
    externalIssueKey: jiraStory.key,
    externalIssueId: jiraStory.id,
    externalProjectKey: config.project_key,
    externalProvider: 'jira',
  });

  // Record sync
  createSyncRecord(db, {
    entityType: 'story',
    entityId: story.id,
    provider: 'jira',
    externalId: jiraStory.id,
  });

  // Move to active sprint
  const movedToSprint = await tryMoveToActiveSprint(client, config, [jiraStory.key]);
  if (movedToSprint) {
    updateStory(db, story.id, { inSprint: true });
  }

  return { jiraKey: jiraStory.key, jiraId: jiraStory.id };
}
