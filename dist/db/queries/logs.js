import { queryAll, queryOne, run } from '../client.js';
export function createLog(db, input) {
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO agent_logs (agent_id, story_id, event_type, status, message, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
        input.agentId,
        input.storyId || null,
        input.eventType,
        input.status || null,
        input.message || null,
        metadata,
        now
    ]);
    // Get the last inserted row
    const result = queryOne(db, 'SELECT last_insert_rowid() as id');
    return getLogById(db, result?.id || 0);
}
export function getLogById(db, id) {
    return queryOne(db, 'SELECT * FROM agent_logs WHERE id = ?', [id]);
}
export function getLogsByAgent(db, agentId, limit = 100) {
    return queryAll(db, `
    SELECT * FROM agent_logs
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `, [agentId, limit]);
}
export function getLogsByStory(db, storyId) {
    return queryAll(db, `
    SELECT * FROM agent_logs
    WHERE story_id = ?
    ORDER BY timestamp DESC
  `, [storyId]);
}
export function getLogsByEventType(db, eventType, limit = 100) {
    return queryAll(db, `
    SELECT * FROM agent_logs
    WHERE event_type = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `, [eventType, limit]);
}
export function getRecentLogs(db, limit = 50) {
    return queryAll(db, `
    SELECT * FROM agent_logs
    ORDER BY timestamp DESC
    LIMIT ?
  `, [limit]);
}
export function getLogsSince(db, since) {
    return queryAll(db, `
    SELECT * FROM agent_logs
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `, [since]);
}
export function pruneOldLogs(db, retentionDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoff = cutoffDate.toISOString();
    // Get count before delete
    const before = queryOne(db, `
    SELECT COUNT(*) as count FROM agent_logs WHERE timestamp < ?
  `, [cutoff]);
    run(db, `DELETE FROM agent_logs WHERE timestamp < ?`, [cutoff]);
    return before?.count || 0;
}
//# sourceMappingURL=logs.js.map