import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createAgent(db, input) {
    const id = input.type === 'tech_lead'
        ? 'tech-lead'
        : `${input.type}-${nanoid(8)}`;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO agents (id, type, team_id, tmux_session, model, status, created_at, updated_at, last_seen)
    VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?)
  `, [id, input.type, input.teamId || null, input.tmuxSession || null, input.model || null, now, now, now]);
    return getAgentById(db, id);
}
export function getAgentById(db, id) {
    return queryOne(db, 'SELECT * FROM agents WHERE id = ?', [id]);
}
export function getAgentsByTeam(db, teamId) {
    return queryAll(db, 'SELECT * FROM agents WHERE team_id = ?', [teamId]);
}
export function getAgentsByType(db, type) {
    return queryAll(db, 'SELECT * FROM agents WHERE type = ?', [type]);
}
export function getAgentsByStatus(db, status) {
    return queryAll(db, 'SELECT * FROM agents WHERE status = ?', [status]);
}
export function getAllAgents(db) {
    return queryAll(db, 'SELECT * FROM agents ORDER BY type, team_id');
}
export function getActiveAgents(db) {
    return queryAll(db, `
    SELECT * FROM agents
    WHERE status IN ('idle', 'working', 'blocked')
    ORDER BY type, team_id
  `);
}
export function getTechLead(db) {
    return queryOne(db, `SELECT * FROM agents WHERE type = 'tech_lead'`);
}
export function updateAgent(db, id, input) {
    const updates = ['updated_at = ?'];
    const values = [new Date().toISOString()];
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
    }
    if (input.tmuxSession !== undefined) {
        updates.push('tmux_session = ?');
        values.push(input.tmuxSession);
    }
    if (input.currentStoryId !== undefined) {
        updates.push('current_story_id = ?');
        values.push(input.currentStoryId);
    }
    if (input.memoryState !== undefined) {
        updates.push('memory_state = ?');
        values.push(input.memoryState);
    }
    if (updates.length === 1) {
        // Only updated_at, nothing to update
        return getAgentById(db, id);
    }
    values.push(id);
    run(db, `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`, values);
    return getAgentById(db, id);
}
export function deleteAgent(db, id) {
    run(db, 'DELETE FROM agents WHERE id = ?', [id]);
}
export function terminateAgent(db, id) {
    updateAgent(db, id, { status: 'terminated', tmuxSession: null });
}
//# sourceMappingURL=agents.js.map