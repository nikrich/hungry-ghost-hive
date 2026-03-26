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

export async function getUnreadMessages(
  provider: DatabaseProvider,
  toSession: string
): Promise<MessageRow[]> {
  return await provider.queryAll<MessageRow>(
    `
    SELECT * FROM messages
    WHERE to_session = ? AND status = 'pending'
    ORDER BY created_at ASC
  `,
    [toSession]
  );
}

export async function markMessageRead(
  provider: DatabaseProvider,
  messageId: string
): Promise<void> {
  await provider.run(`UPDATE messages SET status = 'read' WHERE id = ? AND status = 'pending'`, [
    messageId,
  ]);
}

export async function markMessagesRead(
  provider: DatabaseProvider,
  messageIds: string[]
): Promise<void> {
  if (messageIds.length === 0) return;
  const placeholders = messageIds.map(() => '?').join(',');
  await provider.run(
    `UPDATE messages SET status = 'read' WHERE id IN (${placeholders}) AND status = 'pending'`,
    messageIds
  );
}

export async function getMessageById(
  provider: DatabaseProvider,
  id: string
): Promise<MessageRow | undefined> {
  return await provider.queryOne<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
}

export async function getAllPendingMessages(provider: DatabaseProvider): Promise<MessageRow[]> {
  return await provider.queryAll<MessageRow>(`
    SELECT * FROM messages
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);
}
