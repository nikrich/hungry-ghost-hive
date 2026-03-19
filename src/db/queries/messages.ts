// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../provider.js';

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

export function getUnreadMessages(provider: DatabaseProvider, toSession: string): MessageRow[] {
  return provider.queryAll<MessageRow>(
    `
    SELECT * FROM messages
    WHERE to_session = ? AND status = 'pending'
    ORDER BY created_at ASC
  `,
    [toSession]
  );
}

export function markMessageRead(provider: DatabaseProvider, messageId: string): void {
  provider.run(`UPDATE messages SET status = 'read' WHERE id = ? AND status = 'pending'`, [
    messageId,
  ]);
}

export function markMessagesRead(provider: DatabaseProvider, messageIds: string[]): void {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  provider.run(
    `UPDATE messages SET status = 'read' WHERE id IN (${placeholders}) AND status = 'pending'`,
    messageIds
  );
}

export function getMessageById(provider: DatabaseProvider, id: string): MessageRow | undefined {
  return provider.queryOne<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
}

export function getAllPendingMessages(provider: DatabaseProvider): MessageRow[] {
  return provider.queryAll<MessageRow>(`
    SELECT * FROM messages
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);
}
