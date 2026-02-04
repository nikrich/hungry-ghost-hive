export function createLog(db, input) {
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const stmt = db.prepare(`
    INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    const result = stmt.run(input.agentId, input.storyId || null, input.eventType, input.status || null, input.message || null, metadata);
    return getLogById(db, Number(result.lastInsertRowid));
}
export function getLogById(db, id) {
    return db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(id);
}
export function getLogsByAgent(db, agentId, limit = 100) {
    return db.prepare(`
    SELECT * FROM agent_logs
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(agentId, limit);
}
export function getLogsByStory(db, storyId) {
    return db.prepare(`
    SELECT * FROM agent_logs
    WHERE story_id = ?
    ORDER BY timestamp DESC
  `).all(storyId);
}
export function getLogsByEventType(db, eventType, limit = 100) {
    return db.prepare(`
    SELECT * FROM agent_logs
    WHERE event_type = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(eventType, limit);
}
export function getRecentLogs(db, limit = 50) {
    return db.prepare(`
    SELECT * FROM agent_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
}
export function getLogsSince(db, since) {
    return db.prepare(`
    SELECT * FROM agent_logs
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `).all(since);
}
export function pruneOldLogs(db, retentionDays) {
    const result = db.prepare(`
    DELETE FROM agent_logs
    WHERE timestamp < datetime('now', '-' || ? || ' days')
  `).run(retentionDays);
    return result.changes;
}
//# sourceMappingURL=logs.js.map