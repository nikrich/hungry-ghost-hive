// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, type StoryRow } from '../client.js';
import { addDualWrite, buildDynamicUpdate, type FieldMap } from '../utils/dynamic-update.js';

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

export function createStory(db: Database, input: CreateStoryInput): StoryRow {
  const id = `STORY-${nanoid(6).toUpperCase()}`;
  const acceptanceCriteria = input.acceptanceCriteria
    ? JSON.stringify(input.acceptanceCriteria)
    : null;
  const now = new Date().toISOString();

  run(
    db,
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

  return getStoryById(db, id)!;
}

export function getStoryById(db: Database, id: string): StoryRow | undefined {
  return queryOne<StoryRow>(db, 'SELECT * FROM stories WHERE id = ?', [id]);
}

export function getStoriesByRequirement(db: Database, requirementId: string): StoryRow[] {
  return queryAll<StoryRow>(
    db,
    'SELECT * FROM stories WHERE requirement_id = ? ORDER BY created_at',
    [requirementId]
  );
}

export function getStoriesByTeam(db: Database, teamId: string): StoryRow[] {
  return queryAll<StoryRow>(db, 'SELECT * FROM stories WHERE team_id = ? ORDER BY created_at', [
    teamId,
  ]);
}

export function getStoriesByStatus(db: Database, status: StoryStatus): StoryRow[] {
  return queryAll<StoryRow>(db, 'SELECT * FROM stories WHERE status = ? ORDER BY created_at', [
    status,
  ]);
}

export function getStoriesByAgent(db: Database, agentId: string): StoryRow[] {
  return queryAll<StoryRow>(
    db,
    'SELECT * FROM stories WHERE assigned_agent_id = ? ORDER BY created_at',
    [agentId]
  );
}

export function getActiveStoriesByAgent(db: Database, agentId: string): StoryRow[] {
  return queryAll<StoryRow>(
    db,
    `
    SELECT * FROM stories
    WHERE assigned_agent_id = ?
    AND status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')
    ORDER BY created_at
  `,
    [agentId]
  );
}

export function getAllStories(db: Database): StoryRow[] {
  return queryAll<StoryRow>(db, 'SELECT * FROM stories ORDER BY created_at DESC');
}

export function getPlannedStories(db: Database): StoryRow[] {
  return queryAll<StoryRow>(
    db,
    `
    SELECT * FROM stories
    WHERE status = 'planned'
    ORDER BY story_points DESC, created_at
  `
  );
}

export function getInProgressStories(db: Database): StoryRow[] {
  return queryAll<StoryRow>(
    db,
    `
    SELECT * FROM stories
    WHERE status IN ('in_progress', 'review', 'qa', 'qa_failed')
    ORDER BY created_at
  `
  );
}

export function getStoryPointsByTeam(db: Database, teamId: string): number {
  const result = queryOne<{ total: number }>(
    db,
    `
    SELECT COALESCE(SUM(story_points), 0) as total
    FROM stories
    WHERE team_id = ? AND status IN ('planned', 'in_progress', 'review', 'qa')
  `,
    [teamId]
  );
  return result?.total || 0;
}

const storyFieldMap: FieldMap = {
  teamId: 'team_id',
  title: 'title',
  description: 'description',
  acceptanceCriteria: {
    column: 'acceptance_criteria',
    transform: (v) => (v ? JSON.stringify(v) : null),
  },
  complexityScore: 'complexity_score',
  storyPoints: 'story_points',
  status: 'status',
  assignedAgentId: 'assigned_agent_id',
  branchName: 'branch_name',
  prUrl: 'pr_url',
  externalProvider: 'external_provider',
  inSprint: { column: 'in_sprint', transform: (v) => (v ? 1 : 0) },
};

const storyDualWritePairs = [
  { current: 'externalIssueKey', legacy: 'jiraIssueKey', currentColumn: 'external_issue_key', legacyColumn: 'jira_issue_key' },
  { current: 'externalIssueId', legacy: 'jiraIssueId', currentColumn: 'external_issue_id', legacyColumn: 'jira_issue_id' },
  { current: 'externalProjectKey', legacy: 'jiraProjectKey', currentColumn: 'external_project_key', legacyColumn: 'jira_project_key' },
  { current: 'externalSubtaskKey', legacy: 'jiraSubtaskKey', currentColumn: 'external_subtask_key', legacyColumn: 'jira_subtask_key' },
  { current: 'externalSubtaskId', legacy: 'jiraSubtaskId', currentColumn: 'external_subtask_id', legacyColumn: 'jira_subtask_id' },
];

export function updateStory(
  db: Database,
  id: string,
  input: UpdateStoryInput
): StoryRow | undefined {
  const result = buildDynamicUpdate(input, storyFieldMap, { includeUpdatedAt: true });
  addDualWrite(result, input, storyDualWritePairs);

  if (result.updates.length === 1) {
    return getStoryById(db, id);
  }

  result.values.push(id);
  run(db, `UPDATE stories SET ${result.updates.join(', ')} WHERE id = ?`, result.values);
  return getStoryById(db, id);
}

export function deleteStory(db: Database, id: string): void {
  run(db, 'DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [id, id]);
  run(db, 'DELETE FROM stories WHERE id = ?', [id]);
}

// Story dependencies
export function addStoryDependency(db: Database, storyId: string, dependsOnStoryId: string): void {
  run(
    db,
    `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    VALUES (?, ?)
  `,
    [storyId, dependsOnStoryId]
  );
}

export function removeStoryDependency(
  db: Database,
  storyId: string,
  dependsOnStoryId: string
): void {
  run(db, 'DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?', [
    storyId,
    dependsOnStoryId,
  ]);
}

export function getStoryDependencies(db: Database, storyId: string): StoryRow[] {
  return queryAll<StoryRow>(
    db,
    `
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.depends_on_story_id
    WHERE sd.story_id = ?
  `,
    [storyId]
  );
}

export function getStoriesDependingOn(db: Database, storyId: string): StoryRow[] {
  return queryAll<StoryRow>(
    db,
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
export function getBatchStoryDependencies(db: Database, storyIds: string[]): Map<string, string[]> {
  if (storyIds.length === 0) return new Map();

  const placeholders = storyIds.map(() => '?').join(',');
  const rows = queryAll<{ story_id: string; depends_on_story_id: string }>(
    db,
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

export function getStoryCounts(db: Database): Record<StoryStatus, number> {
  const rows = queryAll<{ status: StoryStatus; count: number }>(
    db,
    `
    SELECT status, COUNT(*) as count
    FROM stories
    GROUP BY status
  `
  );

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
  db: Database
): Array<{ id: string; agent_id: string }> {
  return queryAll<{ id: string; agent_id: string }>(
    db,
    `
    SELECT s.id, s.assigned_agent_id as agent_id
    FROM stories s
    WHERE s.assigned_agent_id IS NOT NULL
    AND s.assigned_agent_id NOT IN (
      SELECT id FROM agents WHERE status != 'terminated'
    )
  `
  );
}

export function getStaleInProgressStoriesWithoutAssignment(db: Database): Array<{ id: string }> {
  return queryAll<{ id: string }>(
    db,
    `
    SELECT id
    FROM stories
    WHERE status = 'in_progress'
      AND assigned_agent_id IS NULL
  `
  );
}

export function getInProgressStoriesWithInconsistentAssignments(
  db: Database
): Array<{ id: string; agent_id: string }> {
  return queryAll<{ id: string; agent_id: string }>(
    db,
    `
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
  `
  );
}

/** @deprecated Use getStoryByExternalKey instead */
export function getStoryByJiraKey(db: Database, jiraIssueKey: string): StoryRow | undefined {
  return queryOne<StoryRow>(
    db,
    'SELECT * FROM stories WHERE external_issue_key = ? OR jira_issue_key = ?',
    [jiraIssueKey, jiraIssueKey]
  );
}

export function getStoryByExternalKey(
  db: Database,
  externalIssueKey: string
): StoryRow | undefined {
  return queryOne<StoryRow>(
    db,
    'SELECT * FROM stories WHERE external_issue_key = ? OR jira_issue_key = ?',
    [externalIssueKey, externalIssueKey]
  );
}

export function updateStoryAssignment(db: Database, storyId: string, agentId: string | null): void {
  run(db, 'UPDATE stories SET assigned_agent_id = ?, updated_at = ? WHERE id = ?', [
    agentId,
    new Date().toISOString(),
    storyId,
  ]);
}
