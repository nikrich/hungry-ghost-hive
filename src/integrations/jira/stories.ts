// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import type { TokenStore } from '../../auth/token-store.js';
import type { JiraConfig } from '../../config/schema.js';
import type { StoryRow } from '../../db/client.js';
import { createSyncRecord } from '../../db/queries/integration-sync.js';
import { updateRequirement, type RequirementRow } from '../../db/queries/requirements.js';
import { getStoryById, getStoryDependencies, updateStory } from '../../db/queries/stories.js';
import { JiraClient } from './client.js';
import { createIssue, createIssueLink } from './issues.js';
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
 * Build the description ADF for a story, including acceptance criteria if present.
 */
function buildStoryDescription(description: string, acceptanceCriteria: string[]): AdfDocument {
  if (acceptanceCriteria.length > 0) {
    return acceptanceCriteriaToAdf(description, acceptanceCriteria);
  }
  return textToAdf(description);
}

/**
 * Sync a requirement and its stories to Jira.
 * Creates a Jira Epic for the requirement, then creates Jira Stories under it.
 * Creates issue links for story dependencies.
 * Mirrors all keys/IDs back to the local DB.
 */
export async function syncRequirementToJira(
  db: Database,
  tokenStore: TokenStore,
  config: JiraConfig,
  requirement: RequirementRow,
  storyIds: string[],
  teamName?: string
): Promise<JiraSyncResult> {
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

  // Step 1: Create Jira Epic for the requirement
  const labels = ['hive-managed'];
  if (teamName) {
    labels.push(teamName);
  }

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

    result.epicKey = epic.key;
    result.epicId = epic.id;

    // Update requirement with Jira epic info
    updateRequirement(db, requirement.id, {
      jiraEpicKey: epic.key,
      jiraEpicId: epic.id,
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

  // Step 2: Create Jira Stories under the epic
  const storyKeyMap: Record<string, string> = {};

  for (const storyId of storyIds) {
    const story = getStoryById(db, storyId);
    if (!story) {
      result.errors.push(`Story ${storyId} not found in local DB`);
      continue;
    }

    try {
      const acceptanceCriteria = story.acceptance_criteria
        ? (JSON.parse(story.acceptance_criteria) as string[])
        : [];

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

      if (story.story_points !== null) {
        fields.story_points = story.story_points;
      }

      if (epic?.key) {
        fields.parent = { key: epic.key };
      }

      const jiraStory = await createIssue(client, { fields } as any);

      // Update local story with Jira info
      updateStory(db, storyId, {
        jiraIssueKey: jiraStory.key,
        jiraIssueId: jiraStory.id,
        jiraProjectKey: config.project_key,
      });

      // Record sync state
      createSyncRecord(db, {
        entityType: 'story',
        entityId: storyId,
        provider: 'jira',
        externalId: jiraStory.id,
      });

      storyKeyMap[storyId] = jiraStory.key;
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

  return result;
}

/**
 * Sync a single story to Jira (for use by CLI `hive stories create`).
 * If an epic already exists for the requirement, links the story to it.
 */
export async function syncStoryToJira(
  db: Database,
  tokenStore: TokenStore,
  config: JiraConfig,
  story: StoryRow,
  teamName?: string
): Promise<{ jiraKey: string; jiraId: string } | null> {
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
    if (req?.jira_epic_key) {
      epicKey = req.jira_epic_key;
    }
  }

  const acceptanceCriteria = story.acceptance_criteria
    ? (JSON.parse(story.acceptance_criteria) as string[])
    : [];

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

  if (story.story_points !== null) {
    fields.story_points = story.story_points;
  }

  if (epicKey) {
    fields.parent = { key: epicKey };
  }

  const jiraStory = await createIssue(client, { fields } as any);

  // Update local story
  updateStory(db, story.id, {
    jiraIssueKey: jiraStory.key,
    jiraIssueId: jiraStory.id,
    jiraProjectKey: config.project_key,
  });

  // Record sync
  createSyncRecord(db, {
    entityType: 'story',
    entityId: story.id,
    provider: 'jira',
    externalId: jiraStory.id,
  });

  return { jiraKey: jiraStory.key, jiraId: jiraStory.id };
}
