import type { Database } from 'sql.js';
import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../../client.js';
import type { StoryDao } from '../interfaces/story.dao.js';
import type { StoryRow, CreateStoryInput, UpdateStoryInput, StoryStatus } from '../../queries/stories.js';

export class SqliteStoryDao implements StoryDao {
  constructor(private readonly db: Database) {}

  async createStory(input: CreateStoryInput): Promise<StoryRow> {
    const id = `STORY-${nanoid(6).toUpperCase()}`;
    const acceptanceCriteria = input.acceptanceCriteria
      ? JSON.stringify(input.acceptanceCriteria)
      : null;
    const now = new Date().toISOString();

    run(this.db, `
      INSERT INTO stories (id, requirement_id, team_id, title, description, acceptance_criteria, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, input.requirementId || null, input.teamId || null, input.title, input.description, acceptanceCriteria, now, now]);

    return (await this.getStoryById(id))!;
  }

  async getStoryById(id: string): Promise<StoryRow | undefined> {
    return queryOne<StoryRow>(this.db, 'SELECT * FROM stories WHERE id = ?', [id]);
  }

  async getStoriesByRequirement(requirementId: string): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, 'SELECT * FROM stories WHERE requirement_id = ? ORDER BY created_at', [requirementId]);
  }

  async getStoriesByTeam(teamId: string): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, 'SELECT * FROM stories WHERE team_id = ? ORDER BY created_at', [teamId]);
  }

  async getStoriesByStatus(status: StoryStatus): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, 'SELECT * FROM stories WHERE status = ? ORDER BY created_at', [status]);
  }

  async getStoriesByAgent(agentId: string): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, 'SELECT * FROM stories WHERE assigned_agent_id = ? ORDER BY created_at', [agentId]);
  }

  async getActiveStoriesByAgent(agentId: string): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE assigned_agent_id = ?
      AND status IN ('planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')
      ORDER BY created_at
    `, [agentId]);
  }

  async getAllStories(): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, 'SELECT * FROM stories ORDER BY created_at DESC');
  }

  async getPlannedStories(): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE status = 'planned'
      ORDER BY story_points DESC, created_at
    `);
  }

  async getInProgressStories(): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, `
      SELECT * FROM stories
      WHERE status IN ('in_progress', 'review', 'qa', 'qa_failed')
      ORDER BY created_at
    `);
  }

  async getStoryPointsByTeam(teamId: string): Promise<number> {
    const result = queryOne<{ total: number }>(this.db, `
      SELECT COALESCE(SUM(story_points), 0) as total
      FROM stories
      WHERE team_id = ? AND status IN ('planned', 'in_progress', 'review', 'qa')
    `, [teamId]);
    return result?.total || 0;
  }

  async updateStory(id: string, input: UpdateStoryInput): Promise<StoryRow | undefined> {
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

    if (updates.length === 1) {
      return this.getStoryById(id);
    }

    values.push(id);
    run(this.db, `UPDATE stories SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getStoryById(id);
  }

  async deleteStory(id: string): Promise<void> {
    run(this.db, 'DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [id, id]);
    run(this.db, 'DELETE FROM stories WHERE id = ?', [id]);
  }

  async addStoryDependency(storyId: string, dependsOnStoryId: string): Promise<void> {
    run(this.db, `
      INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
      VALUES (?, ?)
    `, [storyId, dependsOnStoryId]);
  }

  async removeStoryDependency(storyId: string, dependsOnStoryId: string): Promise<void> {
    run(this.db, 'DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?', [storyId, dependsOnStoryId]);
  }

  async getStoryDependencies(storyId: string): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, `
      SELECT s.* FROM stories s
      JOIN story_dependencies sd ON s.id = sd.depends_on_story_id
      WHERE sd.story_id = ?
    `, [storyId]);
  }

  async getStoriesDependingOn(storyId: string): Promise<StoryRow[]> {
    return queryAll<StoryRow>(this.db, `
      SELECT s.* FROM stories s
      JOIN story_dependencies sd ON s.id = sd.story_id
      WHERE sd.depends_on_story_id = ?
    `, [storyId]);
  }

  async getStoryCounts(): Promise<Record<StoryStatus, number>> {
    const rows = queryAll<{ status: StoryStatus; count: number }>(this.db, `
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

  async getStoriesWithOrphanedAssignments(): Promise<Array<{ id: string; agent_id: string }>> {
    return queryAll<{ id: string; agent_id: string }>(
      this.db,
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

  async updateStoryAssignment(storyId: string, agentId: string | null): Promise<void> {
    run(this.db, 'UPDATE stories SET assigned_agent_id = ?, updated_at = ? WHERE id = ?', [
      agentId,
      new Date().toISOString(),
      storyId,
    ]);
  }
}
