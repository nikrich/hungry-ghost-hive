import { queryAll, queryOne, run } from '../client.js';
export function getUnreadMessages(db, toSession) {
    return queryAll(db, `
    SELECT * FROM messages
    WHERE to_session = ? AND status = 'pending'
    ORDER BY created_at ASC
  `, [toSession]);
}
export function markMessageRead(db, messageId) {
    run(db, `UPDATE messages SET status = 'read' WHERE id = ? AND status = 'pending'`, [messageId]);
}
export function markMessagesRead(db, messageIds) {
    if (messageIds.length === 0)
        return;
    const placeholders = messageIds.map(() => '?').join(',');
    run(db, `UPDATE messages SET status = 'read' WHERE id IN (${placeholders}) AND status = 'pending'`, messageIds);
}
export function getMessageById(db, id) {
    return queryOne(db, 'SELECT * FROM messages WHERE id = ?', [id]);
}
export function getAllPendingMessages(db) {
    return queryAll(db, `
    SELECT * FROM messages
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);
}
//# sourceMappingURL=messages.js.map