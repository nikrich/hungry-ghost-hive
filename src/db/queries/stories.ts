import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

// Re-export StoryRow for convenience
export type { StoryRow } from '../client.js';
import type { StoryRow } from '../client.js';

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
}

export function createStory(db: Database.Database, input: CreateStoryInput): StoryRow {
  const id = `STORY-${nanoid(6).toUpperCase()}`;
  const acceptanceCriteria = input.acceptanceCriteria
    ? JSON.stringify(input.acceptanceCriteria)
    : null;

  const stmt = db.prepare(`
    INSERT INTO stories (id, requirement_id, team_id, title, description, acceptance_criteria)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, input.requirementId || null, input.teamId || null, input.title, input.description, acceptanceCriteria);
  return getStoryById(db, id)!;
}

export function getStoryById(db: Database.Database, id: string): StoryRow | undefined {
  return db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined;
}

export function getStoriesByRequirement(db: Database.Database, requirementId: string): StoryRow[] {
  return db.prepare('SELECT * FROM stories WHERE requirement_id = ? ORDER BY created_at').all(requirementId) as StoryRow[];
}

export function getStoriesByTeam(db: Database.Database, teamId: string): StoryRow[] {
  return db.prepare('SELECT * FROM stories WHERE team_id = ? ORDER BY created_at').all(teamId) as StoryRow[];
}

export function getStoriesByStatus(db: Database.Database, status: StoryStatus): StoryRow[] {
  return db.prepare('SELECT * FROM stories WHERE status = ? ORDER BY created_at').all(status) as StoryRow[];
}

export function getStoriesByAgent(db: Database.Database, agentId: string): StoryRow[] {
  return db.prepare('SELECT * FROM stories WHERE assigned_agent_id = ? ORDER BY created_at').all(agentId) as StoryRow[];
}

export function getAllStories(db: Database.Database): StoryRow[] {
  return db.prepare('SELECT * FROM stories ORDER BY created_at DESC').all() as StoryRow[];
}

export function getPlannedStories(db: Database.Database): StoryRow[] {
  return db.prepare(`
    SELECT * FROM stories
    WHERE status = 'planned'
    ORDER BY story_points DESC, created_at
  `).all() as StoryRow[];
}

export function getInProgressStories(db: Database.Database): StoryRow[] {
  return db.prepare(`
    SELECT * FROM stories
    WHERE status IN ('in_progress', 'review', 'qa', 'qa_failed')
    ORDER BY created_at
  `).all() as StoryRow[];
}

export function getStoryPointsByTeam(db: Database.Database, teamId: string): number {
  const result = db.prepare(`
    SELECT COALESCE(SUM(story_points), 0) as total
    FROM stories
    WHERE team_id = ? AND status IN ('planned', 'in_progress', 'review', 'qa')
  `).get(teamId) as { total: number };
  return result.total;
}

export function updateStory(db: Database.Database, id: string, input: UpdateStoryInput): StoryRow | undefined {
  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: (string | number | null)[] = [];

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

  if (updates.length === 1) {
    return getStoryById(db, id);
  }

  values.push(id);
  db.prepare(`UPDATE stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getStoryById(db, id);
}

export function deleteStory(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?').run(id, id);
  db.prepare('DELETE FROM stories WHERE id = ?').run(id);
}

// Story dependencies
export function addStoryDependency(db: Database.Database, storyId: string, dependsOnStoryId: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    VALUES (?, ?)
  `).run(storyId, dependsOnStoryId);
}

export function removeStoryDependency(db: Database.Database, storyId: string, dependsOnStoryId: string): void {
  db.prepare('DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?').run(storyId, dependsOnStoryId);
}

export function getStoryDependencies(db: Database.Database, storyId: string): StoryRow[] {
  return db.prepare(`
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.depends_on_story_id
    WHERE sd.story_id = ?
  `).all(storyId) as StoryRow[];
}

export function getStoriesDependingOn(db: Database.Database, storyId: string): StoryRow[] {
  return db.prepare(`
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.story_id
    WHERE sd.depends_on_story_id = ?
  `).all(storyId) as StoryRow[];
}

export function getStoryCounts(db: Database.Database): Record<StoryStatus, number> {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM stories
    GROUP BY status
  `).all() as { status: StoryStatus; count: number }[];

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
