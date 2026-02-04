import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createStory(db, input) {
    const id = `STORY-${nanoid(6).toUpperCase()}`;
    const acceptanceCriteria = input.acceptanceCriteria
        ? JSON.stringify(input.acceptanceCriteria)
        : null;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO stories (id, requirement_id, team_id, title, description, acceptance_criteria, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, input.requirementId || null, input.teamId || null, input.title, input.description, acceptanceCriteria, now, now]);
    return getStoryById(db, id);
}
export function getStoryById(db, id) {
    return queryOne(db, 'SELECT * FROM stories WHERE id = ?', [id]);
}
export function getStoriesByRequirement(db, requirementId) {
    return queryAll(db, 'SELECT * FROM stories WHERE requirement_id = ? ORDER BY created_at', [requirementId]);
}
export function getStoriesByTeam(db, teamId) {
    return queryAll(db, 'SELECT * FROM stories WHERE team_id = ? ORDER BY created_at', [teamId]);
}
export function getStoriesByStatus(db, status) {
    return queryAll(db, 'SELECT * FROM stories WHERE status = ? ORDER BY created_at', [status]);
}
export function getStoriesByAgent(db, agentId) {
    return queryAll(db, 'SELECT * FROM stories WHERE assigned_agent_id = ? ORDER BY created_at', [agentId]);
}
export function getAllStories(db) {
    return queryAll(db, 'SELECT * FROM stories ORDER BY created_at DESC');
}
export function getPlannedStories(db) {
    return queryAll(db, `
    SELECT * FROM stories
    WHERE status = 'planned'
    ORDER BY story_points DESC, created_at
  `);
}
export function getInProgressStories(db) {
    return queryAll(db, `
    SELECT * FROM stories
    WHERE status IN ('in_progress', 'review', 'qa', 'qa_failed')
    ORDER BY created_at
  `);
}
export function getStoryPointsByTeam(db, teamId) {
    const result = queryOne(db, `
    SELECT COALESCE(SUM(story_points), 0) as total
    FROM stories
    WHERE team_id = ? AND status IN ('planned', 'in_progress', 'review', 'qa')
  `, [teamId]);
    return result?.total || 0;
}
export function updateStory(db, id, input) {
    const updates = ['updated_at = ?'];
    const values = [new Date().toISOString()];
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
    run(db, `UPDATE stories SET ${updates.join(', ')} WHERE id = ?`, values);
    return getStoryById(db, id);
}
export function deleteStory(db, id) {
    run(db, 'DELETE FROM story_dependencies WHERE story_id = ? OR depends_on_story_id = ?', [id, id]);
    run(db, 'DELETE FROM stories WHERE id = ?', [id]);
}
// Story dependencies
export function addStoryDependency(db, storyId, dependsOnStoryId) {
    run(db, `
    INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id)
    VALUES (?, ?)
  `, [storyId, dependsOnStoryId]);
}
export function removeStoryDependency(db, storyId, dependsOnStoryId) {
    run(db, 'DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?', [storyId, dependsOnStoryId]);
}
export function getStoryDependencies(db, storyId) {
    return queryAll(db, `
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.depends_on_story_id
    WHERE sd.story_id = ?
  `, [storyId]);
}
export function getStoriesDependingOn(db, storyId) {
    return queryAll(db, `
    SELECT s.* FROM stories s
    JOIN story_dependencies sd ON s.id = sd.story_id
    WHERE sd.depends_on_story_id = ?
  `, [storyId]);
}
export function getStoryCounts(db) {
    const rows = queryAll(db, `
    SELECT status, COUNT(*) as count
    FROM stories
    GROUP BY status
  `);
    const counts = {
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
//# sourceMappingURL=stories.js.map