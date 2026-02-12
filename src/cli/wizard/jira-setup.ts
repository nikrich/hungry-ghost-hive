// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { confirm, input, select } from '@inquirer/prompts';
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

/** Hive internal statuses */
type HiveStatus = 'draft' | 'in_progress' | 'review' | 'merged';

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
  const response = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

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
 * Auto-detect status mapping from Jira statuses to Hive statuses.
 * Uses status category and common naming patterns.
 */
export function autoDetectStatusMapping(
  jiraStatuses: JiraStatus[]
): Record<string, HiveStatus> {
  const mapping: Record<string, HiveStatus> = {};

  for (const status of jiraStatuses) {
    const statusName = status.name.toLowerCase();
    const categoryKey = status.statusCategory.key.toLowerCase();

    // Map based on status category first
    if (categoryKey === 'new' || categoryKey === 'undefined') {
      mapping[status.name] = 'draft';
    } else if (categoryKey === 'indeterminate') {
      mapping[status.name] = 'in_progress';
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
        statusName.includes('complete')
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
  const { cloudId, siteUrl, accessToken, nonInteractive, jiraProject } = options;

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
    console.log(
      chalk.gray(`  ${jiraStatus}`) + chalk.cyan(` → `) + chalk.green(hiveStatus)
    );
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
          { name: 'in_progress (doing, development)', value: 'in_progress' },
          { name: 'review (testing, qa)', value: 'review' },
          { name: 'merged (done, closed)', value: 'merged' },
        ],
        default: autoMapping[status.name],
      });
      finalMapping[status.name] = hiveStatus as HiveStatus;
    }
  }

  // Step 4: Detect board for the project
  console.log();
  console.log(chalk.gray(`Fetching boards for ${selectedProject.key}...`));
  const boards = await fetchProjectBoards(cloudId, accessToken, selectedProject.key);

  let boardId: string;

  if (boards.length === 0) {
    console.log(chalk.yellow('No boards found for this project.'));
    boardId = await input({
      message: 'Enter board ID manually (or leave empty)',
      default: '1',
    });
  } else if (boards.length === 1) {
    console.log(chalk.green(`Using board: ${boards[0].name} (ID: ${boards[0].id})`));
    boardId = String(boards[0].id);
  } else {
    const selectedBoard = await select({
      message: 'Select a board',
      choices: boards.map(b => ({
        name: `${b.name} (${b.type})`,
        value: b,
      })),
    });
    boardId = String(selectedBoard.id);
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
  const project = projects.find(
    p => p.key.toLowerCase() === jiraProject.toLowerCase()
  );

  if (!project) {
    throw new Error(
      `Project "${jiraProject}" not found. Available projects: ${projects.map(p => p.key).join(', ')}`
    );
  }

  // Fetch statuses and auto-detect mapping
  const statuses = await fetchProjectStatuses(cloudId, accessToken, project.key);
  const statusMapping = autoDetectStatusMapping(statuses);

  // Fetch boards and use the first one
  const boards = await fetchProjectBoards(cloudId, accessToken, project.key);
  const boardId = boards.length > 0 ? String(boards[0].id) : '1';

  return {
    jiraConfig: {
      project_key: project.key,
      site_url: siteUrl,
      board_id: boardId,
      story_type: 'Story',
      subtask_type: 'Subtask',
      status_mapping: statusMapping,
    },
  };
}
