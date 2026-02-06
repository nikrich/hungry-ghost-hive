import type { MessageRow } from '../../queries/messages.js';

export type { MessageRow };

export interface MessageDao {
  getUnreadMessages(toSession: string): Promise<MessageRow[]>;
  markMessageRead(messageId: string): Promise<void>;
  getMessageById(id: string): Promise<MessageRow | undefined>;
  getAllPendingMessages(): Promise<MessageRow[]>;
}
