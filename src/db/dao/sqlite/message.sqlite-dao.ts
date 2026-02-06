import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../../client.js';
import type { MessageDao } from '../interfaces/message.dao.js';
import type { MessageRow } from '../../queries/messages.js';

export class SqliteMessageDao implements MessageDao {
  constructor(private readonly db: Database) {}

  async getUnreadMessages(toSession: string): Promise<MessageRow[]> {
    return queryAll<MessageRow>(this.db, `
      SELECT * FROM messages
      WHERE to_session = ? AND status = 'pending'
      ORDER BY created_at ASC
    `, [toSession]);
  }

  async markMessageRead(messageId: string): Promise<void> {
    run(this.db, `UPDATE messages SET status = 'read' WHERE id = ? AND status = 'pending'`, [messageId]);
  }

  async getMessageById(id: string): Promise<MessageRow | undefined> {
    return queryOne<MessageRow>(this.db, 'SELECT * FROM messages WHERE id = ?', [id]);
  }

  async getAllPendingMessages(): Promise<MessageRow[]> {
    return queryAll<MessageRow>(this.db, `
      SELECT * FROM messages
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `);
  }
}
