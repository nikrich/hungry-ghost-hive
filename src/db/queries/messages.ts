// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../client.js';

export interface MessageRow {
  id: string;
  from_session: string;
  to_session: string;
  subject: string | null;
  body: string;
  reply: string | null;
  status: 'pending' | 'read' | 'replied';
  created_at: string;
  replied_at: string | null;
}

export function getUnreadMessages(db: Database, toSession: string): MessageRow[] {
  return queryAll<MessageRow>(
    db,
    `
    SELECT * FROM messages
    WHERE to_session = ? AND status = 'pending'
    ORDER BY created_at ASC
  `,
    [toSession]
  );
}

export function markMessageRead(db: Database, messageId: string): void {
  run(db, `UPDATE messages SET status = 'read' WHERE id = ? AND status = 'pending'`, [messageId]);
}

export function markMessagesRead(db: Database, messageIds: string[]): void {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  run(
    db,
    `UPDATE messages SET status = 'read' WHERE id IN (${placeholders}) AND status = 'pending'`,
    messageIds
  );
}

export function getMessageById(db: Database, id: string): MessageRow | undefined {
  return queryOne<MessageRow>(db, 'SELECT * FROM messages WHERE id = ?', [id]);
}

export function getAllPendingMessages(db: Database): MessageRow[] {
  return queryAll<MessageRow>(
    db,
    `
    SELECT * FROM messages
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `
  );
}
