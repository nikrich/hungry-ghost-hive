import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from 'sql.js';
import { createTestDb } from './helpers.js';
import { SqliteMessageDao } from '../sqlite/message.sqlite-dao.js';
import { run } from '../../client.js';

describe('SqliteMessageDao', () => {
  let db: Database;
  let dao: SqliteMessageDao;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteMessageDao(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertMessage(id: string, from: string, to: string, body: string, status = 'pending') {
    run(db, `
      INSERT INTO messages (id, from_session, to_session, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, from, to, body, status, new Date().toISOString()]);
  }

  it('message.sqlite-dao case 1', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello');
    insertMessage('m2', 'agent-1', 'agent-2', 'World');
    insertMessage('m3', 'agent-1', 'agent-3', 'Other');

    const messages = await dao.getUnreadMessages('agent-2');
    expect(messages).toHaveLength(2);
    expect(messages[0].body).toBe('Hello');
    expect(messages[1].body).toBe('World');
  });

  it('message.sqlite-dao case 2', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello');
    insertMessage('m2', 'agent-1', 'agent-2', 'World', 'read');

    const messages = await dao.getUnreadMessages('agent-2');
    expect(messages).toHaveLength(1);
  });

  it('message.sqlite-dao case 3', async () => {
    const messages = await dao.getUnreadMessages('agent-2');
    expect(messages).toEqual([]);
  });

  it('message.sqlite-dao case 4', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello');

    await dao.markMessageRead('m1');

    const msg = await dao.getMessageById('m1');
    expect(msg!.status).toBe('read');
  });

  it('message.sqlite-dao case 5', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello', 'read');

    await dao.markMessageRead('m1'); // already read, should be no-op

    const msg = await dao.getMessageById('m1');
    expect(msg!.status).toBe('read');
  });

  it('message.sqlite-dao case 6', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello');

    const msg = await dao.getMessageById('m1');
    expect(msg).toBeDefined();
    expect(msg!.id).toBe('m1');
    expect(msg!.from_session).toBe('agent-1');
    expect(msg!.to_session).toBe('agent-2');
    expect(msg!.body).toBe('Hello');
  });

  it('message.sqlite-dao case 7', async () => {
    expect(await dao.getMessageById('nonexistent')).toBeUndefined();
  });

  it('message.sqlite-dao case 8', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello');
    insertMessage('m2', 'agent-1', 'agent-3', 'World');
    insertMessage('m3', 'agent-1', 'agent-2', 'Read', 'read');

    const pending = await dao.getAllPendingMessages();
    expect(pending).toHaveLength(2);
  });

  it('message.sqlite-dao case 9', async () => {
    insertMessage('m1', 'agent-1', 'agent-2', 'Hello', 'read');
    const pending = await dao.getAllPendingMessages();
    expect(pending).toEqual([]);
  });
});
