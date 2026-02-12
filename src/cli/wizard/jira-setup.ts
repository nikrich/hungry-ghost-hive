// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { JiraConfig } from '../../config/schema.js';

/** Jira project from the API */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

/** Jira workflow status */
export interface JiraStatus {
  id: string;
  name: string;
  statusCategory: {
    id: number;
    key: string;
    name: string;
  };
}

/** Jira board from Agile API */
export interface JiraBoard {
  id: number;
  name: string;
  type: string;
}

/** Hive internal statuses that can be mapped to Jira */
type HiveStatus =
  | 'draft'
  | 'estimated'
  | 'planned'
  | 'in_progress'
  | 'review'
  | 'qa'
  | 'qa_failed'
  | 'pr_submitted'
  | 'merged';

/** Options for running the Jira setup wizard */
export interface JiraSetupOptions {
  cloudId: string;
  siteUrl: string;
  accessToken: string;
  nonInteractive?: boolean;
  jiraProject?: string;
}

/** Result from the Jira setup wizard */
export interface JiraSetupResult {
  jiraConfig: JiraConfig;
}

/**
 * Fetch all accessible Jira projects for the authenticated user.
 */
export async function fetchJiraProjects(
  cloudId: string,
  accessToken: string
): Promise<JiraProject[]> {
  const response = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch Jira projects (${response.status}): ${body}`);
  }

  return (await response.json()) as JiraProject[];
}

/**
 * Fetch workflow statuses for a specific Jira project.
 */
export async function fetchProjectStatuses(
  cloudId: string,
  accessToken: string,
  projectKey: string
): Promise<JiraStatus[]> {
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${projectKey}/statuses`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch project statuses (${response.status}): ${body}`);
  }

  const issueTypes = (await response.json()) as Array<{
    id: string;
    name: string;
    statuses: JiraStatus[];
  }>;

  // Collect all unique statuses across issue types
  const statusMap = new Map<string, JiraStatus>();
  for (const issueType of issueTypes) {
    for (const status of issueType.statuses) {
      if (!statusMap.has(status.id)) {
        statusMap.set(status.id, status);
      }
    }
  }

  return Array.from(statusMap.values());
}

/**
 * Fetch boards for a specific Jira project.
 */
export async function fetchProjectBoards(
  cloudId: string,
  accessToken: string,
  projectKey: string
): Promise<JiraBoard[]> {
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/board?projectKeyOrId=${projectKey}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch project boards (${response.status}): ${body}`);
  }

  const result = (await response.json()) as { values: JiraBoard[] };
  return result.values;
}

/**
 * Extract a board ID from a Jira board URL.
 * Supports formats:
 *   - https://mycompany.atlassian.net/jira/software/projects/PROJ/boards/42
 *   - https://mycompany.atlassian.net/secure/RapidBoard.jspa?rapidView=42
 *   - https://mycompany.atlassian.net/jira/software/c/projects/PROJ/boards/42
 * Returns the board ID string, or null if parsing fails.
 */
export function parseBoardIdFromUrl(boardUrl: string): string | null {
  try {
    const url = new URL(boardUrl);

    // Format: /jira/software/projects/PROJ/boards/42 or /jira/software/c/projects/PROJ/boards/42
    const boardsMatch = url.pathname.match(/\/boards\/(\d+)/);
    if (boardsMatch) {
      return boardsMatch[1];
    }

    // Format: /secure/RapidBoard.jspa?rapidView=42
    const rapidView = url.searchParams.get('rapidView');
    if (rapidView && /^\d+$/.test(rapidView)) {
      return rapidView;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate that a board ID exists via the Jira Agile API.
 */
export async function validateBoardId(
  cloudId: string,
  accessToken: string,
  boardId: string
): Promise<JiraBoard | null> {
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/board/${boardId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as JiraBoard;
}

/**
 * Create a new Jira board for a project via the Agile API.
 */
export async function createJiraBoard(
  cloudId: string,
  accessToken: string,
  options: { name: string; type: 'scrum' | 'kanban'; projectKey: string }
): Promise<JiraBoard> {
  // First, get the project to find its filter or create one
  const filterResponse = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/filter`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: `${options.name} filter`,
        jql: `project = ${options.projectKey} ORDER BY Rank ASC`,
      }),
    }
  );

  if (!filterResponse.ok) {
    const body = await filterResponse.text();
    throw new Error(`Failed to create board filter (${filterResponse.status}): ${body}`);
  }

  const filter = (await filterResponse.json()) as { id: string };

  // Create the board using the filter
  const boardResponse = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/board`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: options.name,
        type: options.type,
        filterId: Number(filter.id),
      }),
    }
  );

  if (!boardResponse.ok) {
    const body = await boardResponse.text();
    throw new Error(`Failed to create board (${boardResponse.status}): ${body}`);
  }

  return (await boardResponse.json()) as JiraBoard;
}

/** Jira field definition */
interface JiraField {
  id: string;
  name: string;
  schema?: { type: string };
}

/**
 * Detect the story points field ID for a Jira site.
 * Returns the field ID (e.g., "story_points" or "customfield_10016").
 */
export async function detectStoryPointsField(
  cloudId: string,
  accessToken: string
): Promise<string> {
  try {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/field`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) return 'story_points';

    const fields = (await response.json()) as JiraField[];

    // Look for the story points field — common names/IDs
    for (const f of fields) {
      const name = (f.name || '').toLowerCase();
      if (f.id === 'story_points') return 'story_points';
      if (name === 'story points' || name === 'story point estimate') return f.id;
    }
  } catch {
    // Fall through to default
  }
  return 'story_points';
}

/**
 * Auto-detect status mapping from Jira statuses to Hive statuses.
 * Uses status category and common naming patterns.
 */
export function autoDetectStatusMapping(jiraStatuses: JiraStatus[]): Record<string, HiveStatus> {
  const mapping: Record<string, HiveStatus> = {};

  for (const status of jiraStatuses) {
    const statusName = status.name.toLowerCase();
    const categoryKey = status.statusCategory.key.toLowerCase();

    // Try specific naming patterns first (more precise matching)
    if (statusName.includes('qa fail') || statusName.includes('qa reject')) {
      mapping[status.name] = 'qa_failed';
    } else if (
      statusName === 'qa' ||
      statusName.includes('quality assurance') ||
      statusName.includes('qa review')
    ) {
      mapping[status.name] = 'qa';
    } else if (
      statusName.includes('code review') ||
      statusName.includes('peer review') ||
      statusName.includes('in review')
    ) {
      mapping[status.name] = 'review';
    } else if (
      statusName.includes('pr submitted') ||
      statusName.includes('pull request') ||
      statusName.includes('awaiting review')
    ) {
      mapping[status.name] = 'pr_submitted';
    } else if (statusName.includes('testing') || statusName.includes('test')) {
      mapping[status.name] = 'qa';
    } else if (categoryKey === 'new' || categoryKey === 'undefined') {
      // Map based on status category
      if (statusName.includes('backlog')) {
        mapping[status.name] = 'draft';
      } else if (statusName.includes('selected') || statusName.includes('ready')) {
        mapping[status.name] = 'planned';
      } else {
        mapping[status.name] = 'draft';
      }
    } else if (categoryKey === 'indeterminate') {
      if (
        statusName.includes('review') ||
        statusName.includes('testing') ||
        statusName.includes('qa')
      ) {
        mapping[status.name] = 'review';
      } else {
        mapping[status.name] = 'in_progress';
      }
    } else if (categoryKey === 'done') {
      mapping[status.name] = 'merged';
    } else {
      // Fallback: use naming patterns
      if (
        statusName.includes('todo') ||
        statusName.includes('to do') ||
        statusName.includes('backlog')
      ) {
        mapping[status.name] = 'draft';
      } else if (
        statusName.includes('selected') ||
        statusName.includes('ready') ||
        statusName.includes('planned')
      ) {
        mapping[status.name] = 'planned';
      } else if (
        statusName.includes('progress') ||
        statusName.includes('development') ||
        statusName.includes('doing')
      ) {
        mapping[status.name] = 'in_progress';
      } else if (
        statusName.includes('review') ||
        statusName.includes('testing') ||
        statusName.includes('qa')
      ) {
        mapping[status.name] = 'review';
      } else if (
        statusName.includes('done') ||
        statusName.includes('closed') ||
        statusName.includes('complete') ||
        statusName.includes('resolved')
      ) {
        mapping[status.name] = 'merged';
      } else {
        // Default to in_progress for unknown statuses
        mapping[status.name] = 'in_progress';
      }
    }
  }

  return mapping;
}

/**
 * Run the Jira setup wizard after OAuth completes.
 * Fetches projects, lets user select one, detects status mapping,
 * and saves configuration.
 */
export async function runJiraSetup(options: JiraSetupOptions): Promise<JiraSetupResult> {
  const { cloudId, siteUrl, accessToken, nonInteractive } = options;

  if (nonInteractive) {
    return runNonInteractiveSetup(options);
  }

  console.log();
  console.log(chalk.bold('Jira Setup'));
  console.log();

  // Step 1: Fetch and select project
  console.log(chalk.gray('Fetching Jira projects...'));
  const projects = await fetchJiraProjects(cloudId, accessToken);

  if (projects.length === 0) {
    throw new Error('No Jira projects found. Please create a project in Jira first.');
  }

  const selectedProject = await select({
    message: 'Select a Jira project',
    choices: projects.map(p => ({
      name: `${p.key} - ${p.name}`,
      value: p,
    })),
  });

  console.log(chalk.gray(`Fetching workflow statuses for ${selectedProject.key}...`));
  const statuses = await fetchProjectStatuses(cloudId, accessToken, selectedProject.key);

  // Step 2: Auto-detect status mapping
  const autoMapping = autoDetectStatusMapping(statuses);

  console.log();
  console.log(chalk.bold('Detected Status Mapping:'));
  console.log();
  for (const [jiraStatus, hiveStatus] of Object.entries(autoMapping)) {
    console.log(chalk.gray(`  ${jiraStatus}`) + chalk.cyan(` → `) + chalk.green(hiveStatus));
  }
  console.log();

  // Step 3: Let user confirm or adjust mapping
  const confirmMapping = await confirm({
    message: 'Use this status mapping?',
    default: true,
  });

  let finalMapping = autoMapping;

  if (!confirmMapping) {
    console.log();
    console.log(chalk.yellow('Adjust status mapping manually:'));
    console.log();

    finalMapping = {};
    for (const status of statuses) {
      const hiveStatus = await select({
        message: `Map "${status.name}" to`,
        choices: [
          { name: 'draft (backlog, todo)', value: 'draft' },
          { name: 'planned (ready, selected for development)', value: 'planned' },
          { name: 'in_progress (doing, development)', value: 'in_progress' },
          { name: 'review (code review, peer review)', value: 'review' },
          { name: 'pr_submitted (pull request, awaiting review)', value: 'pr_submitted' },
          { name: 'qa (testing, quality assurance)', value: 'qa' },
          { name: 'qa_failed (QA rejected)', value: 'qa_failed' },
          { name: 'merged (done, closed)', value: 'merged' },
        ],
        default: autoMapping[status.name],
      });
      finalMapping[status.name] = hiveStatus as HiveStatus;
    }
  }

  // Step 4: Board selection for sprint operations
  let boardId: string | undefined;
  try {
    console.log(chalk.gray(`Fetching boards for ${selectedProject.key}...`));
    const boards = await fetchProjectBoards(cloudId, accessToken, selectedProject.key);

    if (boards.length === 1) {
      boardId = String(boards[0].id);
      console.log(chalk.gray(`Auto-selected board: ${boards[0].name} (${boards[0].type})`));
    } else if (boards.length > 1) {
      const selectedBoard = await select({
        message: 'Select a board (used for sprint operations)',
        choices: boards.map(b => ({
          name: `${b.name} (${b.type})`,
          value: b,
        })),
      });
      boardId = String(selectedBoard.id);
    } else {
      console.log(chalk.yellow('No boards found. Sprint operations will use best-effort discovery.'));
    }
  } catch {
    console.log(chalk.yellow('Could not fetch boards. Sprint operations will use best-effort discovery.'));
  }

  // Step 5: Detect story points field
  console.log(chalk.gray('Detecting story points field...'));
  const storyPointsField = await detectStoryPointsField(cloudId, accessToken);
  if (storyPointsField !== 'story_points') {
    console.log(chalk.gray(`Using custom field for story points: ${storyPointsField}`));
  }

  console.log();
  console.log(chalk.green('Jira setup complete!'));

  return {
    jiraConfig: {
      project_key: selectedProject.key,
      site_url: siteUrl,
      board_id: boardId,
      story_type: 'Story',
      subtask_type: 'Subtask',
      story_points_field: storyPointsField,
      status_mapping: finalMapping,
    },
  };
}

/**
 * Run Jira setup in non-interactive mode.
 */
async function runNonInteractiveSetup(options: JiraSetupOptions): Promise<JiraSetupResult> {
  const { cloudId, siteUrl, accessToken, jiraProject } = options;

  if (!jiraProject) {
    throw new Error('--jira-project flag is required in non-interactive mode');
  }

  // Fetch projects to validate the provided project key
  const projects = await fetchJiraProjects(cloudId, accessToken);
  const project = projects.find(p => p.key.toLowerCase() === jiraProject.toLowerCase());

  if (!project) {
    throw new Error(
      `Project "${jiraProject}" not found. Available projects: ${projects.map(p => p.key).join(', ')}`
    );
  }

  // Fetch statuses and auto-detect mapping
  const statuses = await fetchProjectStatuses(cloudId, accessToken, project.key);
  const statusMapping = autoDetectStatusMapping(statuses);

  // Try to auto-detect board
  let boardId: string | undefined;
  try {
    const boards = await fetchProjectBoards(cloudId, accessToken, project.key);
    if (boards.length === 1) {
      boardId = String(boards[0].id);
    }
  } catch {
    // Board detection is best-effort in non-interactive mode
  }

  // Auto-detect story points field
  const storyPointsField = await detectStoryPointsField(cloudId, accessToken);

  return {
    jiraConfig: {
      project_key: project.key,
      site_url: siteUrl,
      board_id: boardId,
      story_type: 'Story',
      subtask_type: 'Subtask',
      story_points_field: storyPointsField,
      status_mapping: statusMapping,
    },
  };
}
