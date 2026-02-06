import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createEscalation(db, input) {
    const id = `ESC-${nanoid(6).toUpperCase()}`;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO escalations (id, story_id, from_agent_id, to_agent_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
        id,
        input.storyId || null,
        input.fromAgentId || null,
        input.toAgentId || null,
        input.reason,
        now
    ]);
    return getEscalationById(db, id);
}
export function getEscalationById(db, id) {
    return queryOne(db, 'SELECT * FROM escalations WHERE id = ?', [id]);
}
export function getEscalationsByStory(db, storyId) {
    return queryAll(db, `
    SELECT * FROM escalations
    WHERE story_id = ?
    ORDER BY created_at DESC
  `, [storyId]);
}
export function getEscalationsByFromAgent(db, agentId) {
    return queryAll(db, `
    SELECT * FROM escalations
    WHERE from_agent_id = ?
    ORDER BY created_at DESC
  `, [agentId]);
}
export function getEscalationsByToAgent(db, agentId) {
    if (agentId === null) {
        return queryAll(db, `
      SELECT * FROM escalations
      WHERE to_agent_id IS NULL
      ORDER BY created_at DESC
    `);
    }
    return queryAll(db, `
    SELECT * FROM escalations
    WHERE to_agent_id = ?
    ORDER BY created_at DESC
  `, [agentId]);
}
export function getEscalationsByStatus(db, status) {
    return queryAll(db, `
    SELECT * FROM escalations
    WHERE status = ?
    ORDER BY created_at DESC
  `, [status]);
}
export function getPendingEscalations(db) {
    return getEscalationsByStatus(db, 'pending');
}
export function getPendingHumanEscalations(db) {
    return queryAll(db, `
    SELECT * FROM escalations
    WHERE status = 'pending' AND to_agent_id IS NULL
    ORDER BY created_at
  `);
}
export function getAllEscalations(db) {
    return queryAll(db, 'SELECT * FROM escalations ORDER BY created_at DESC');
}
export function updateEscalation(db, id, input) {
    const updates = [];
    const values = [];
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
        if (input.status === 'resolved') {
            updates.push('resolved_at = ?');
            values.push(new Date().toISOString());
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
    run(db, `UPDATE escalations SET ${updates.join(', ')} WHERE id = ?`, values);
    return getEscalationById(db, id);
}
export function resolveEscalation(db, id, resolution) {
    return updateEscalation(db, id, { status: 'resolved', resolution });
}
export function acknowledgeEscalation(db, id) {
    return updateEscalation(db, id, { status: 'acknowledged' });
}
export function deleteEscalation(db, id) {
    run(db, 'DELETE FROM escalations WHERE id = ?', [id]);
}
//# sourceMappingURL=escalations.js.map