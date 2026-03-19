// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import { deleteStoryMarkdown, writeStoryMarkdown } from '../../utils/story-markdown.js';
import type { StoryRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { StoryRow };

export type StoryStatus =
  | 'draft'
  | 'estimated'
  | 'planned'
  | 'in_progress'
  | 'review'
  | 'qa'
  | 'qa_failed'
  | 'pr_submitted'
  | 'merged';

export interface CreateStoryInput {
  requirementId?: string | null;
  teamId?: string | null;
  title: string;
  description: string;
  acceptanceCriteria?: string[] | null;
}

export interface UpdateStoryInput {
  teamId?: string | null;
  title?: string;
  description?: string;
  acceptanceCriteria?: string[] | null;
  complexityScore?: number | null;
  storyPoints?: number | null;
  status?: StoryStatus;
  assignedAgentId?: string | null;
  branchName?: string | null;
  prUrl?: string | null;
  /** @deprecated Use externalIssueKey instead */
  jiraIssueKey?: string | null;
  /** @deprecated Use externalIssueId instead */
  jiraIssueId?: string | null;
  /** @deprecated Use externalProjectKey instead */
  jiraProjectKey?: string | null;
  /** @deprecated Use externalSubtaskKey instead */
  jiraSubtaskKey?: string | null;
  /** @deprecated Use externalSubtaskId instead */
  jiraSubtaskId?: string | null;
  externalIssueKey?: string | null;
  externalIssueId?: string | null;
  externalProjectKey?: string | null;
  externalSubtaskKey?: string | null;
  externalSubtaskId?: string | null;
  externalProvider?: string | null;
  inSprint?: boolean;
}

export function createStory(
  provider: DatabaseProvider,
  input: CreateStoryInput,
  storiesDir?: string
): StoryRow {
  const id = `STORY-${nanoid(6).toUpperCase()}`;
  const acceptanceCriteria = input.acceptanceCriteria
    ? JSON.stringify(input.acceptanceCriteria)
    : null;
  const now = new Date().toISOString();

  provider.run(
    `
    INSERT INTO stories (id, requirement_id, team_id, title, description, acceptance_criteria, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      id,
      input.requirementId || null,
      input.teamId || null,
      input.title,
      input.description,
      acceptanceCriteria,
      now,
      now,
    ]
  );

  const story = getStoryById(provider, id)!;

  if (storiesDir) {
    const markdownPath = writeStoryMarkdown(storiesDir, story);
    provider.run('UPDATE stories SET markdown_path = ? WHERE id = ?', [markdownPath, id]);
    story.markdown_path = markdownPath;
  }

  return story;
}

export function getStoryById(provider: DatabaseProvider, id: string): StoryRow | undefined {
  return provider.queryOne<StoryRow>('SELECT * FROM stories WHERE id = ? COLLATE NOCASE', [id]);
}

export function getStoriesByRequirement(
  provider: DatabaseProvider,
  requirementId: string
): StoryRow[] {
  return provider.queryAll<StoryRow>(
    'SELECT * FROM stories WHERE requirement_id = ? ORDER BY created_at',
    [requirementId]
  );
}

export function getStoriesByTeam(provider: DatabaseProvider, teamId: string): StoryRow[] {
  return provider.queryAll<StoryRow>(
    'SELECT * FROM stories WHERE team_id = ? ORDER BY created_at',
    [teamId]
  );
}

export function getStoriesByStatus(provider: DatabaseProvider, status: StoryStatus): StoryRow[] {
  return provider.queryAll<StoryRow>('SELECT * FROM stories WHERE status = ? ORDER BY created_at', [
    status,
  ]);
}

export function getStoriesByAgent(provider: DatabaseProvider, agentId: string): StoryRow[] {
  return provider.queryAll<StoryRow>(
    'SELECT * FROM stories WHERE assigned_agent_id = ? ORDER BY created_at',
    [agentId]
  );
}

export function getActiveStoriesByAgent(provider: DatabaseProvider, agentId: string): StoryRow[] {
  return provider.queryAll<StoryRow>(
    `
    SELECT * FROM stories
    WHERE assigned_agent_id = ?
    AND status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')
    ORDER BY created_at
  `,
    [agentId]
  );
}

export function getAllStories(provider: DatabaseProvider): StoryRow[] {
  return provider.queryAll<StoryRow>('SELECT * FROM stories ORDER BY created_at DESC');
}

export function getPlannedStories(provider: DatabaseProvider): StoryRow[] {
  return provider.queryAll<StoryRow>(`
    SELECT * FROM stories
    WHERE status = 'planned'
    ORDER BY story_points DESC, created_at
  `);
}

export function getInProgressStories(provider: DatabaseProvider): StoryRow[] {
  return provider.queryAll<StoryRow>(`
    SELECT * FROM stories
    WHERE status IN ('in_progress', 'review', 'qa', 'qa_failed')
    ORDER BY created_at
  `);
}

export function getStoryPointsByTeam(provider: DatabaseProvider, teamId: string): number {
  const result = provider.queryOne<{ total: number }>(
    `
    SELECT COALESCE(SUM(story_points), 0) as total
    FROM stories
    WHERE team_id = ? AND status IN ('planned', 'in_progress', 'review', 'qa')
  `,
    [teamId]
  );
  return result?.total || 0;
}

export function updateStory(
  provider: DatabaseProvider,
  id: string,
  input: UpdateStoryInput,
  storiesDir?: string
): StoryRow | undefined {
  const updates: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [new Date().toISOString()];

  if (input.teamId !== undefined) {
    updates.push('team_id = ?');
    values.push(input.teamId);
  }
  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(input.title);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.acceptanceCriteria !== undefined) {
    updates.push('acceptance_criteria = ?');
    values.push(input.acceptanceCriteria ? JSON.stringify(input.acceptanceCriteria) : null);
  }
  if (input.complexityScore !== undefined) {
    updates.push('complexity_score = ?');
    values.push(input.complexityScore);
  }
  if (input.storyPoints !== undefined) {
    updates.push('story_points = ?');
    values.push(input.storyPoints);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.assignedAgentId !== undefined) {
    updates.push('assigned_agent_id = ?');
    values.push(input.assignedAgentId);
  }
  if (input.branchName !== undefined) {
    updates.push('branch_name = ?');
    values.push(input.branchName);
  }
  if (input.prUrl !== undefined) {
    updates.push('pr_url = ?');
    values.push(input.prUrl);
  }
  // Dual-write: support both legacy jira_* and new external_* columns
  const issueKey =
    input.externalIssueKey !== undefined ? input.externalIssueKey : input.jiraIssueKey;
  const issueId = input.externalIssueId !== undefined ? input.externalIssueId : input.jiraIssueId;
  const projectKey =
    input.externalProjectKey !== undefined ? input.externalProjectKey : input.jiraProjectKey;
  const subtaskKey =
    input.externalSubtaskKey !== undefined ? input.externalSubtaskKey : input.jiraSubtaskKey;
  const subtaskId =
    input.externalSubtaskId !== undefined ? input.externalSubtaskId : input.jiraSubtaskId;

  if (issueKey !== undefined) {
    updates.push('jira_issue_key = ?');
    values.push(issueKey);
    updates.push('external_issue_key = ?');
    values.push(issueKey);
  }
  if (issueId !== undefined) {
    updates.push('jira_issue_id = ?');
    values.push(issueId);
    updates.push('external_issue_id = ?');
    values.push(issueId);
  }
  if (projectKey !== undefined) {
    updates.push('jira_project_key = ?');
    values.push(projectKey);
    updates.push('external_project_key = ?');
    values.push(projectKey);
  }
  if (subtaskKey !== undefined) {
    updates.push('jira_subtask_key = ?');
    values.push(subtaskKey);
    updates.push('external_subtask_key = ?');
    values.push(subtaskKey);
  }
  if (subtaskId !== undefined) {
    updates.push('jira_subtask_id = ?');
    values.push(subtaskId);
    updates.push('external_subtask_id = ?');
    values.push(subtaskId);
  }
  if (input.externalProvider !== undefined) {
    updates.push('external_provider = ?');
    values.push(input.externalProvider);
  }
  if (input.inSprint !== undefined) {
    updates.push('in_sprint = ?');
    values.push(input.inSprint ? 1 : 0);
  }

  if (updates.length === 1) {
    return getStoryById(provider, id);
  }

  values.push(id);
  provider.run(`UPDATE stories SET ${updates.join(', ')} WHERE id = ?`, values);

  const updatedStory = getStoryById(provider, id);

  if (storiesDir && updatedStory) {
    const markdownPath = writeStoryMarkdown(storiesDir, updatedStory);
    if (updatedStory.markdown_path !== markdownPath) {
      provider.run('UPDATE stories SET markdown_path = ? WHERE id = ?', [markdownPath, id]);
      updatedStory.markdown_path = markdownPath;
    }
  }

  return updatedStory;
}

export function deleteStory(provider: DatabaseProvider, id: string, storiesDir?: string): void {
  if (storiesDir) {
    deleteStoryMarkdown(storiesDir, id);
  }
  provider.run('DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [
    id,
    id,
  ]);
  provider.run('DELETE FROM stories WHERE id = ?', [id]);
}

// Story dependencies
export function addStoryDependency(
  provider: DatabaseProvider,
  storyId: string,
  dependsOnStoryId: string
): void {
  provider.run(
    `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    VALUES (?, ?)
  `,
    [storyId, dependsOnStoryId]
  );
}

export function removeStoryDependency(
  provider: DatabaseProvider,
  storyId: string,
  dependsOnStoryId: string
): void {
  provider.run('DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?', [
    storyId,
    dependsOnStoryId,
  ]);
}

export function getStoryDependencies(provider: DatabaseProvider, storyId: string): StoryRow[] {
  return provider.queryAll<StoryRow>(
    `
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.depends_on_story_id
    WHERE sd.story_id = ?
  `,
    [storyId]
  );
}

export function getStoriesDependingOn(provider: DatabaseProvider, storyId: string): StoryRow[] {
  return provider.queryAll<StoryRow>(
    `
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.story_id
    WHERE sd.depends_on_story_id = ?
  `,
    [storyId]
  );
}

/**
 * Get dependencies for multiple stories in a single query.
 * Returns a map of story ID to its dependencies for improved query performance.
 * Avoids N+1 queries when building dependency graphs.
 * @param storyIds Array of story IDs to get dependencies for
 * @returns Map of story ID to array of dependent story IDs
 */
export function getBatchStoryDependencies(
  provider: DatabaseProvider,
  storyIds: string[]
): Map<string, string[]> {
  if (storyIds.length === 0) return new Map();

  const placeholders = storyIds.map(() => '?').join(',');
  const rows = provider.queryAll<{ story_id: string; depends_on_story_id: string }>(
    `
    SELECT sd.story_id, sd.depends_on_story_id
    FROM story_dependencies sd
    WHERE sd.story_id IN (${placeholders})
    `,
    storyIds
  );

  const deps = new Map<string, string[]>();
  for (const storyId of storyIds) {
    deps.set(storyId, []);
  }

  for (const row of rows) {
    const depIds = deps.get(row.story_id) || [];
    depIds.push(row.depends_on_story_id);
    deps.set(row.story_id, depIds);
  }

  return deps;
}

export function getStoryCounts(provider: DatabaseProvider): Record<StoryStatus, number> {
  const rows = provider.queryAll<{ status: StoryStatus; count: number }>(`
    SELECT status, COUNT(*) as count
    FROM stories
    GROUP BY status
  `);

  const counts: Record<StoryStatus, number> = {
    draft: 0,
    estimated: 0,
    planned: 0,
    in_progress: 0,
    review: 0,
    qa: 0,
    qa_failed: 0,
    pr_submitted: 0,
    merged: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}

export function getStoriesWithOrphanedAssignments(
  provider: DatabaseProvider
): Array<{ id: string; agent_id: string }> {
  return provider.queryAll<{ id: string; agent_id: string }>(`
    SELECT s.id, s.assigned_agent_id as agent_id
    FROM stories s
    WHERE s.assigned_agent_id IS NOT NULL
    AND s.assigned_agent_id NOT IN (
      SELECT id FROM agents WHERE status != 'terminated'
    )
  `);
}

export function getStaleInProgressStoriesWithoutAssignment(
  provider: DatabaseProvider
): Array<{ id: string }> {
  return provider.queryAll<{ id: string }>(`
    SELECT id
    FROM stories
    WHERE status = 'in_progress'
      AND assigned_agent_id IS NULL
  `);
}

export function getInProgressStoriesWithInconsistentAssignments(
  provider: DatabaseProvider
): Array<{ id: string; agent_id: string }> {
  return provider.queryAll<{ id: string; agent_id: string }>(`
    SELECT s.id, s.assigned_agent_id as agent_id
    FROM stories s
    JOIN agents a ON a.id = s.assigned_agent_id
    WHERE s.status = 'in_progress'
      AND s.assigned_agent_id IS NOT NULL
      AND a.status != 'terminated'
      AND (
        a.status != 'working'
        OR a.current_story_id IS NULL
        OR a.current_story_id != s.id
      )
  `);
}

/** @deprecated Use getStoryByExternalKey instead */
export function getStoryByJiraKey(
  provider: DatabaseProvider,
  jiraIssueKey: string
): StoryRow | undefined {
  return provider.queryOne<StoryRow>(
    'SELECT * FROM stories WHERE external_issue_key = ? OR jira_issue_key = ?',
    [jiraIssueKey, jiraIssueKey]
  );
}

export function getStoryByExternalKey(
  provider: DatabaseProvider,
  externalIssueKey: string
): StoryRow | undefined {
  return provider.queryOne<StoryRow>(
    'SELECT * FROM stories WHERE external_issue_key = ? OR jira_issue_key = ?',
    [externalIssueKey, externalIssueKey]
  );
}

export function updateStoryAssignment(
  provider: DatabaseProvider,
  storyId: string,
  agentId: string | null
): void {
  provider.run('UPDATE stories SET assigned_agent_id = ?, updated_at = ? WHERE id = ?', [
    agentId,
    new Date().toISOString(),
    storyId,
  ]);
}
