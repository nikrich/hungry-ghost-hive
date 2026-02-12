// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { join } from 'path';
import type { Database } from 'sql.js';
import { TokenStore } from '../../auth/token-store.js';
import type { HiveConfig } from '../../config/schema.js';
import { queryOne } from '../../db/client.js';
import type { StoryRow } from '../../db/queries/stories.js';
import * as logger from '../../utils/logger.js';
import { JiraClient } from './client.js';
import { createIssue } from './issues.js';
import type { AdfDocument, CreateIssueResponse } from './types.js';

/**
 * Lifecycle events that trigger Jira comments
 */
export type JiraLifecycleEvent =
  | 'assigned'
  | 'work_started'
  | 'pr_created'
  | 'qa_started'
  | 'qa_passed'
  | 'qa_failed'
  | 'merged'
  | 'blocked';

/**
 * Context for posting lifecycle event comments
 */
export interface CommentContext {
  agentName?: string;
  branchName?: string;
  prUrl?: string;
  reason?: string;
  subtaskKey?: string;
}

/**
 * Options for creating a Jira subtask
 */
export interface CreateSubtaskOptions {
  parentIssueKey: string;
  projectKey: string;
  agentName: string;
  storyTitle: string;
}

/**
 * Create a Jira subtask under a parent story when an agent is assigned.
 *
 * @param client - JiraClient instance
 * @param options - Subtask creation options
 * @returns Created subtask response (key and ID) or null if failed
 */
export async function createSubtask(
  client: JiraClient,
  options: CreateSubtaskOptions
): Promise<CreateIssueResponse | null> {
  try {
    const { parentIssueKey, projectKey, agentName, storyTitle } = options;

    const subtask = await createIssue(client, {
      fields: {
        project: { key: projectKey },
        parent: { key: parentIssueKey },
        summary: `Implementation by ${agentName}`,
        issuetype: { name: 'Subtask' },
        description: {
          version: 1,
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Automated implementation subtask for: ' },
                { type: 'text', text: storyTitle, marks: [{ type: 'strong' }] },
              ],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `This subtask tracks the implementation progress by ${agentName}.`,
                },
              ],
            },
          ],
        },
        labels: ['hive-managed', 'agent-subtask'],
      },
    });

    logger.info(`Created Jira subtask ${subtask.key} for agent ${agentName}`);
    return subtask;
  } catch (err) {
    logger.warn(
      `Failed to create Jira subtask for ${options.agentName}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Post a lifecycle event comment to a Jira issue.
 * Comments are concise and include relevant links (PR URL, branch name, etc.)
 *
 * @param client - JiraClient instance
 * @param issueKey - Jira issue key to comment on
 * @param event - Lifecycle event type
 * @param context - Additional context for the comment
 * @returns true if successful, false otherwise
 */
export async function postComment(
  client: JiraClient,
  issueKey: string,
  event: JiraLifecycleEvent,
  context: CommentContext = {}
): Promise<boolean> {
  try {
    const commentBody = buildCommentBody(event, context);

    await client.request(`/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody }),
    });

    logger.debug(`Posted ${event} comment to Jira issue ${issueKey}`);
    return true;
  } catch (err) {
    logger.warn(
      `Failed to post ${event} comment to Jira ${issueKey}: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

/**
 * Build ADF comment body for a lifecycle event
 */
function buildCommentBody(event: JiraLifecycleEvent, context: CommentContext): AdfDocument {
  const { agentName, branchName, prUrl, reason, subtaskKey } = context;

  switch (event) {
    case 'assigned':
      return createAdfComment([
        createParagraph([
          createEmoji('robot'),
          createText(` Agent ${agentName || 'unknown'} has been assigned to this story.`),
        ]),
        ...(subtaskKey
          ? [
              createParagraph([
                createText('Subtask: '),
                createLink(`https://your-domain.atlassian.net/browse/${subtaskKey}`, subtaskKey),
              ]),
            ]
          : []),
      ]);

    case 'work_started':
      return createAdfComment([
        createParagraph([
          createEmoji('construction'),
          createText(` Work started by ${agentName || 'agent'}.`),
        ]),
        ...(branchName ? [createParagraph([createText('Branch: '), createCode(branchName)])] : []),
      ]);

    case 'pr_created':
      return createAdfComment([
        createParagraph([
          createEmoji('git_pull_request'),
          createText(` Pull request created by ${agentName || 'agent'}.`),
        ]),
        ...(prUrl ? [createParagraph([createText('PR: '), createLink(prUrl, prUrl)])] : []),
      ]);

    case 'qa_started':
      return createAdfComment([
        createParagraph([createEmoji('test_tube'), createText(' QA testing started.')]),
      ]);

    case 'qa_passed':
      return createAdfComment([
        createParagraph([createEmoji('white_check_mark'), createText(' QA testing passed.')]),
      ]);

    case 'qa_failed':
      return createAdfComment([
        createParagraph([createEmoji('x'), createText(' QA testing failed.')]),
        ...(reason
          ? [createParagraph([createText('Reason: '), createText(reason, [{ type: 'em' }])])]
          : []),
      ]);

    case 'merged':
      return createAdfComment([
        createParagraph([createEmoji('tada'), createText(' Pull request merged successfully!')]),
      ]);

    case 'blocked':
      return createAdfComment([
        createParagraph([createEmoji('no_entry'), createText(' Work blocked.')]),
        ...(reason
          ? [createParagraph([createText('Reason: '), createText(reason, [{ type: 'strong' }])])]
          : []),
      ]);

    default:
      return createAdfComment([createParagraph([createText(`Event: ${event}`)])]);
  }
}

// ─── ADF Helper Functions ────────────────────────────────────────────────────

function createAdfComment(content: Array<{ type: string; content?: any[] }>): AdfDocument {
  return {
    version: 1,
    type: 'doc',
    content,
  };
}

function createParagraph(content: any[]) {
  return {
    type: 'paragraph',
    content,
  };
}

function createText(text: string, marks?: Array<{ type: string }>) {
  const node: any = {
    type: 'text',
    text,
  };
  if (marks && marks.length > 0) {
    node.marks = marks;
  }
  return node;
}

function createEmoji(shortName: string) {
  return {
    type: 'emoji',
    attrs: {
      shortName: `:${shortName}:`,
    },
  };
}

function createLink(href: string, text: string) {
  return {
    type: 'text',
    text,
    marks: [
      {
        type: 'link',
        attrs: {
          href,
        },
      },
    ],
  };
}

function createCode(text: string) {
  return {
    type: 'text',
    text,
    marks: [{ type: 'code' }],
  };
}

// ─── Standalone Helper ───────────────────────────────────────────────────────

/**
 * Post a Jira lifecycle comment for a story.
 * This is a standalone helper that can be called from anywhere in the codebase.
 * It handles all the setup (loading config, creating client) and error handling.
 *
 * @param db - Database instance
 * @param hiveDir - Path to the .hive directory
 * @param hiveConfig - Full hive configuration
 * @param storyId - Story ID to post comment for
 * @param event - Lifecycle event type
 * @param context - Additional context for the comment
 */
export async function postJiraLifecycleComment(
  db: Database,
  hiveDir: string,
  hiveConfig: HiveConfig | undefined,
  storyId: string,
  event: JiraLifecycleEvent,
  context: CommentContext = {}
): Promise<void> {
  try {
    // Check if Jira is configured
    if (!hiveConfig) return;
    const pmConfig = hiveConfig.integrations?.project_management;
    if (!pmConfig || pmConfig.provider !== 'jira' || !pmConfig.jira) return;

    // Get story to check if it has a Jira issue key
    const story = queryOne<StoryRow>(db, 'SELECT * FROM stories WHERE id = ?', [storyId]);
    if (!story || !story.jira_issue_key) {
      logger.debug(`Story ${storyId} has no Jira issue key, skipping ${event} comment`);
      return;
    }

    // Load token store
    const tokenStore = new TokenStore(join(hiveDir, '.env'));
    await tokenStore.loadFromEnv();

    // Create Jira client
    const jiraClient = new JiraClient({
      tokenStore,
      clientId: process.env.JIRA_CLIENT_ID || '',
      clientSecret: process.env.JIRA_CLIENT_SECRET || '',
    });

    // Post comment
    await postComment(jiraClient, story.jira_issue_key, event, context);
  } catch (err) {
    logger.warn(
      `Failed to post ${event} Jira comment for story ${storyId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
