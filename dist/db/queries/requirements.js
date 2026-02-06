import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createRequirement(db, input) {
    const id = `REQ-${nanoid(8).toUpperCase()}`;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO requirements (id, title, description, submitted_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [id, input.title, input.description, input.submittedBy || 'human', now]);
    return getRequirementById(db, id);
}
export function getRequirementById(db, id) {
    return queryOne(db, 'SELECT * FROM requirements WHERE id = ?', [id]);
}
export function getAllRequirements(db) {
    return queryAll(db, 'SELECT * FROM requirements ORDER BY created_at DESC');
}
export function getRequirementsByStatus(db, status) {
    return queryAll(db, 'SELECT * FROM requirements WHERE status = ? ORDER BY created_at DESC', [status]);
}
export function getPendingRequirements(db) {
    return queryAll(db, `
    SELECT * FROM requirements
    WHERE status IN ('pending', 'planning', 'in_progress')
    ORDER BY created_at
  `);
}
export function updateRequirement(db, id, input) {
    const updates = [];
    const values = [];
    if (input.title !== undefined) {
        updates.push('title = ?');
        values.push(input.title);
    }
    if (input.description !== undefined) {
        updates.push('description = ?');
        values.push(input.description);
    }
    if (input.status !== undefined) {
        updates.push('status = ?');
        values.push(input.status);
    }
    if (updates.length === 0) {
        return getRequirementById(db, id);
    }
    values.push(id);
    run(db, `UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, values);
    return getRequirementById(db, id);
}
export function deleteRequirement(db, id) {
    run(db, 'DELETE FROM requirements WHERE id = ?', [id]);
}
//# sourceMappingURL=requirements.js.map