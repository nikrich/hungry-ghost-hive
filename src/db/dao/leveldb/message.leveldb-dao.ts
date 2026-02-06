import type { MessageRow } from '../../queries/messages.js';
import type { MessageDao } from '../interfaces/message.dao.js';
import { LevelDbStore } from './leveldb-store.js';
import { compareIsoAsc } from './sort.js';

const MESSAGE_PREFIX = 'message:';

export class LevelDbMessageDao implements MessageDao {
  constructor(private readonly store: LevelDbStore) {}

  async getUnreadMessages(toSession: string): Promise<MessageRow[]> {
    const messages = await this.store.listValues<MessageRow>(MESSAGE_PREFIX);
    return messages
      .filter(msg => msg.to_session === toSession && msg.status === 'pending')
      .sort(compareIsoAsc);
  }

  async markMessageRead(messageId: string): Promise<void> {
    const message = await this.getMessageById(messageId);
    if (!message || message.status !== 'pending') return;
    const updated: MessageRow = {
      ...message,
      status: 'read',
    };
    await this.store.put(`${MESSAGE_PREFIX}${messageId}`, updated);
  }

  async getMessageById(id: string): Promise<MessageRow | undefined> {
    return this.store.get<MessageRow>(`${MESSAGE_PREFIX}${id}`);
  }

  async getAllPendingMessages(): Promise<MessageRow[]> {
    const messages = await this.store.listValues<MessageRow>(MESSAGE_PREFIX);
    return messages.filter(msg => msg.status === 'pending').sort(compareIsoAsc);
  }
}
