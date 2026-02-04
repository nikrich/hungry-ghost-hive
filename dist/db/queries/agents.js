import { nanoid } from 'nanoid';
export function createAgent(db, input) {
    const id = input.type === 'tech_lead'
        ? 'tech-lead'
        : `${input.type}-${nanoid(8)}`;
    const stmt = db.prepare(`
    INSERT INTO agents (id, type, team_id, tmux_session, status)
    VALUES (?, ?, ?, ?, 'idle')
  `);
    stmt.run(id, input.type, input.teamId || null, input.tmuxSession || null);
    return getAgentById(db, id);
}
export function getAgentById(db, id) {
    return db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
}
export function getAgentsByTeam(db, teamId) {
    return db.prepare('SELECT * FROM agents WHERE team_id = ?').all(teamId);
}
export function getAgentsByType(db, type) {
    return db.prepare('SELECT * FROM agents WHERE type = ?').all(type);
}
export function getAgentsByStatus(db, status) {
    return db.prepare('SELECT * FROM agents WHERE status = ?').all(status);
}
export function getAllAgents(db) {
    return db.prepare('SELECT * FROM agents ORDER BY type, team_id').all();
}
export function getActiveAgents(db) {
    return db.prepare(`
    SELECT * FROM agents
    WHERE status IN ('idle', 'working', 'blocked')
    ORDER BY type, team_id
  `).all();
}
export function getTechLead(db) {
    return db.prepare(`SELECT * FROM agents WHERE type = 'tech_lead'`).get();
}
export function updateAgent(db, id, input) {
    const updates = ['updated_at = CURRENT_TIMESTAMP'];
    const values = [];
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
    db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return getAgentById(db, id);
}
export function deleteAgent(db, id) {
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}
export function terminateAgent(db, id) {
    updateAgent(db, id, { status: 'terminated', tmuxSession: null });
}
//# sourceMappingURL=agents.js.map