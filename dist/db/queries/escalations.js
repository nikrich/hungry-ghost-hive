import { nanoid } from 'nanoid';
export function createEscalation(db, input) {
    const id = `ESC-${nanoid(6).toUpperCase()}`;
    const stmt = db.prepare(`
    INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason)
    VALUES (?, ?, ?, ?, ?)
  `);
    stmt.run(id, input.storyId || null, input.fromAgentId || null, input.toAgentId || null, input.reason);
    return getEscalationById(db, id);
}
export function getEscalationById(db, id) {
    return db.prepare('SELECT * FROM escalations WHERE id = ?').get(id);
}
export function getEscalationsByStory(db, storyId) {
    return db.prepare(`
    SELECT * FROM escalations
    WHERE story_id = ?
    ORDER BY created_at DESC
  `).all(storyId);
}
export function getEscalationsByFromAgent(db, agentId) {
    return db.prepare(`
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    ORDER BY created_at DESC
  `).all(agentId);
}
export function getEscalationsByToAgent(db, agentId) {
    if (agentId === null) {
        return db.prepare(`
      SELECT * FROM escalations
      WHERE to_agent_id IS NULL
      ORDER BY created_at DESC
    `).all();
    }
    return db.prepare(`
    SELECT * FROM escalations
    WHERE to_agent_id = ?
    ORDER BY created_at DESC
  `).all(agentId);
}
export function getEscalationsByStatus(db, status) {
    return db.prepare(`
    SELECT * FROM escalations
    WHERE status = ?
    ORDER BY created_at DESC
  `).all(status);
}
export function getPendingEscalations(db) {
    return getEscalationsByStatus(db, 'pending');
}
export function getPendingHumanEscalations(db) {
    return db.prepare(`
    SELECT * FROM escalations
    WHERE status = 'pending' AND to_agent_id IS NULL
    ORDER BY created_at
  `).all();
}
export function getAllEscalations(db) {
    return db.prepare('SELECT * FROM escalations ORDER BY created_at DESC').all();
}
export function updateEscalation(db, id, input) {
    const updates = [];
    const values = [];
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
        if (input.status === 'resolved') {
            updates.push('resolved_at = CURRENT_TIMESTAMP');
        }
    }
    if (input.toAgentId !== undefined) {
        updates.push('to_agent_id = ?');
        values.push(input.toAgentId);
    }
    if (input.resolution !== undefined) {
        updates.push('resolution = ?');
        values.push(input.resolution);
    }
    if (updates.length === 0) {
        return getEscalationById(db, id);
    }
    values.push(id);
    db.prepare(`UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return getEscalationById(db, id);
}
export function resolveEscalation(db, id, resolution) {
    return updateEscalation(db, id, { status: 'resolved', resolution });
}
export function acknowledgeEscalation(db, id) {
    return updateEscalation(db, id, { status: 'acknowledged' });
}
export function deleteEscalation(db, id) {
    db.prepare('DELETE FROM escalations WHERE id = ?').run(id);
}
//# sourceMappingURL=escalations.js.map