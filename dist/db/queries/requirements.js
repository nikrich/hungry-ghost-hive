import { nanoid } from 'nanoid';
export function createRequirement(db, input) {
    const id = `REQ-${nanoid(8).toUpperCase()}`;
    const stmt = db.prepare(`
    INSERT INTO requirements (id, title, description, submitted_by)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(id, input.title, input.description, input.submittedBy || 'human');
    return getRequirementById(db, id);
}
export function getRequirementById(db, id) {
    return db.prepare('SELECT * FROM requirements WHERE id = ?').get(id);
}
export function getAllRequirements(db) {
    return db.prepare('SELECT * FROM requirements ORDER BY created_at DESC').all();
}
export function getRequirementsByStatus(db, status) {
    return db.prepare('SELECT * FROM requirements WHERE status = ? ORDER BY created_at DESC').all(status);
}
export function getPendingRequirements(db) {
    return db.prepare(`
    SELECT * FROM requirements
    WHERE status IN ('pending', 'planning', 'in_progress')
    ORDER BY created_at
  `).all();
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
    db.prepare(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return getRequirementById(db, id);
}
export function deleteRequirement(db, id) {
    db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
}
//# sourceMappingURL=requirements.js.map