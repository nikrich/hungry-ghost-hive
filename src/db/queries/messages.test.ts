import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDatabase } from './test-helpers.js';
import { run } from '../client.js';
import {
  getUnreadMessages,
  markMessageRead,
  getMessageById,
  getAllPendingMessages,
} from './messages.js';

describe('messages queries', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  // Helper function to create a test message
  function createMessage(
    id: string,
    fromSession: string,
    toSession: string,
    body: string,
    status: 'pending' | 'read' | 'replied' = 'pending',
    subject?: string | null
  ): void {
    const now = new Date().toISOString();
    run(
      db,
      `
      INSERT INTO messages (id, from_session, to_session, subject, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [id, fromSession, toSession, subject || null, body, status, now]
    );
  }

  describe('getUnreadMessages', () => {
    it('should return unread messages for a session', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message 1', 'pending');
      createMessage('msg2', 'session-a', 'session-b', 'Message 2', 'pending');
      createMessage('msg3', 'session-a', 'session-b', 'Message 3', 'read');

      const unread = getUnreadMessages(db, 'session-b');

      expect(unread).toHaveLength(2);
      expect(unread.map((m) => m.id)).toContain('msg1');
      expect(unread.map((m) => m.id)).toContain('msg2');
      expect(unread.map((m) => m.id)).not.toContain('msg3');
    });

    it('should return empty array when no unread messages', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message 1', 'read');

      const unread = getUnreadMessages(db, 'session-b');

      expect(unread).toEqual([]);
    });

    it('should order messages by created_at ASC', () => {
      // Create messages with slight delays to ensure ordering
      createMessage('msg1', 'session-a', 'session-b', 'First', 'pending');
      createMessage('msg2', 'session-a', 'session-b', 'Second', 'pending');
      createMessage('msg3', 'session-a', 'session-b', 'Third', 'pending');

      const unread = getUnreadMessages(db, 'session-b');

      expect(unread).toHaveLength(3);
      expect(unread[0].id).toBe('msg1');
      expect(unread[1].id).toBe('msg2');
      expect(unread[2].id).toBe('msg3');
    });

    it('should filter by recipient session', () => {
      createMessage('msg1', 'session-a', 'session-b', 'For B', 'pending');
      createMessage('msg2', 'session-a', 'session-c', 'For C', 'pending');

      const unreadB = getUnreadMessages(db, 'session-b');
      const unreadC = getUnreadMessages(db, 'session-c');

      expect(unreadB).toHaveLength(1);
      expect(unreadB[0].id).toBe('msg1');
      expect(unreadC).toHaveLength(1);
      expect(unreadC[0].id).toBe('msg2');
    });
  });

  describe('markMessageRead', () => {
    it('should mark a pending message as read', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message', 'pending');

      markMessageRead(db, 'msg1');

      const message = getMessageById(db, 'msg1');
      expect(message?.status).toBe('read');
    });

    it('should not affect already read messages', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message', 'read');

      markMessageRead(db, 'msg1');

      const message = getMessageById(db, 'msg1');
      expect(message?.status).toBe('read');
    });

    it('should not affect replied messages', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message', 'replied');

      markMessageRead(db, 'msg1');

      const message = getMessageById(db, 'msg1');
      expect(message?.status).toBe('replied');
    });

    it('should not throw for non-existent message', () => {
      expect(() => markMessageRead(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('getMessageById', () => {
    it('should retrieve a message by ID', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Test message', 'pending', 'Test subject');

      const message = getMessageById(db, 'msg1');

      expect(message).toBeDefined();
      expect(message?.id).toBe('msg1');
      expect(message?.from_session).toBe('session-a');
      expect(message?.to_session).toBe('session-b');
      expect(message?.subject).toBe('Test subject');
      expect(message?.body).toBe('Test message');
      expect(message?.status).toBe('pending');
    });

    it('should return undefined for non-existent message', () => {
      const message = getMessageById(db, 'non-existent-id');
      expect(message).toBeUndefined();
    });

    it('should handle messages without subject', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message without subject', 'pending');

      const message = getMessageById(db, 'msg1');

      expect(message?.subject).toBeNull();
      expect(message?.body).toBe('Message without subject');
    });
  });

  describe('getAllPendingMessages', () => {
    it('should return all pending messages across all sessions', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message 1', 'pending');
      createMessage('msg2', 'session-b', 'session-c', 'Message 2', 'pending');
      createMessage('msg3', 'session-c', 'session-a', 'Message 3', 'read');
      createMessage('msg4', 'session-a', 'session-d', 'Message 4', 'replied');

      const pending = getAllPendingMessages(db);

      expect(pending).toHaveLength(2);
      expect(pending.map((m) => m.id)).toContain('msg1');
      expect(pending.map((m) => m.id)).toContain('msg2');
    });

    it('should return empty array when no pending messages', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Message', 'read');

      const pending = getAllPendingMessages(db);

      expect(pending).toEqual([]);
    });

    it('should order by created_at ASC', () => {
      createMessage('msg1', 'session-a', 'session-b', 'First', 'pending');
      createMessage('msg2', 'session-a', 'session-b', 'Second', 'pending');

      const pending = getAllPendingMessages(db);

      expect(pending[0].id).toBe('msg1');
      expect(pending[1].id).toBe('msg2');
    });
  });

  describe('edge cases', () => {
    it('should handle messages with null subject', () => {
      createMessage('msg1', 'session-a', 'session-b', 'Body text', 'pending', null);

      const message = getMessageById(db, 'msg1');
      expect(message?.subject).toBeNull();
      expect(message?.body).toBe('Body text');
    });

    it('should handle messages with very long body text', () => {
      const longBody = 'A'.repeat(50000);
      createMessage('msg1', 'session-a', 'session-b', longBody, 'pending');

      const message = getMessageById(db, 'msg1');
      expect(message?.body).toBe(longBody);
    });

    it('should handle special characters in message content', () => {
      const specialBody = 'Message with \'quotes\' "double" and\nnewlines\ttabs';
      createMessage('msg1', 'session-a', 'session-b', specialBody, 'pending', 'Special chars');

      const message = getMessageById(db, 'msg1');
      expect(message?.body).toBe(specialBody);
    });

    it('should handle session names with special characters', () => {
      createMessage(
        'msg1',
        'session-with-dashes',
        'session_with_underscores',
        'Message',
        'pending'
      );

      const unread = getUnreadMessages(db, 'session_with_underscores');
      expect(unread).toHaveLength(1);
      expect(unread[0].from_session).toBe('session-with-dashes');
    });

    it('should handle reply and replied_at fields', () => {
      const now = new Date().toISOString();
      run(
        db,
        `
        INSERT INTO messages (id, from_session, to_session, body, status, reply, replied_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ['msg1', 'session-a', 'session-b', 'Original message', 'replied', 'Reply text', now, now]
      );

      const message = getMessageById(db, 'msg1');
      expect(message?.status).toBe('replied');
      expect(message?.reply).toBe('Reply text');
      expect(message?.replied_at).toBeDefined();
    });
  });
});
