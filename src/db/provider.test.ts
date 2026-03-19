// Licensed under the Hungry Ghost Hive License. See LICENSE.

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadOnlySqliteProvider, SqliteProvider } from './provider.js';

describe('SqliteProvider', () => {
  let db: SqlJsDatabase;
  let saveFn: ReturnType<typeof vi.fn>;
  let provider: SqliteProvider;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    db.run(`
      CREATE TABLE IF NOT EXISTS test_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);
    saveFn = vi.fn();
    provider = new SqliteProvider(db, saveFn);
  });

  describe('queryAll', () => {
    it('should return all matching rows', () => {
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'a', 10]);
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['2', 'b', 20]);

      const results = provider.queryAll<{ id: string; name: string; value: number }>(
        'SELECT * FROM test_items ORDER BY id'
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: '1', name: 'a', value: 10 });
      expect(results[1]).toEqual({ id: '2', name: 'b', value: 20 });
    });

    it('should return empty array when no matches', () => {
      const results = provider.queryAll('SELECT * FROM test_items');
      expect(results).toEqual([]);
    });

    it('should support parameterized queries', () => {
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'a', 10]);
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['2', 'b', 20]);

      const results = provider.queryAll<{ id: string; name: string; value: number }>(
        'SELECT * FROM test_items WHERE value > ?',
        [15]
      );

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('2');
    });
  });

  describe('queryOne', () => {
    it('should return the first matching row', () => {
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'a', 10]);

      const result = provider.queryOne<{ id: string; name: string; value: number }>(
        'SELECT * FROM test_items WHERE id = ?',
        ['1']
      );

      expect(result).toEqual({ id: '1', name: 'a', value: 10 });
    });

    it('should return undefined when no match', () => {
      const result = provider.queryOne('SELECT * FROM test_items WHERE id = ?', ['nonexistent']);
      expect(result).toBeUndefined();
    });
  });

  describe('run', () => {
    it('should execute INSERT statements', () => {
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'test', 42]);

      const result = provider.queryOne<{ id: string; name: string; value: number }>(
        'SELECT * FROM test_items WHERE id = ?',
        ['1']
      );
      expect(result).toEqual({ id: '1', name: 'test', value: 42 });
    });

    it('should execute UPDATE statements', () => {
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'test', 42]);
      provider.run('UPDATE test_items SET value = ? WHERE id = ?', [99, '1']);

      const result = provider.queryOne<{ value: number }>(
        'SELECT value FROM test_items WHERE id = ?',
        ['1']
      );
      expect(result?.value).toBe(99);
    });

    it('should execute DELETE statements', () => {
      provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'test', 42]);
      provider.run('DELETE FROM test_items WHERE id = ?', ['1']);

      const result = provider.queryOne('SELECT * FROM test_items WHERE id = ?', ['1']);
      expect(result).toBeUndefined();
    });
  });

  describe('withTransaction', () => {
    it('should commit on success and call save', async () => {
      await provider.withTransaction(() => {
        provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'a', 10]);
        provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['2', 'b', 20]);
      });

      const results = provider.queryAll('SELECT * FROM test_items');
      expect(results).toHaveLength(2);
      expect(saveFn).toHaveBeenCalledOnce();
    });

    it('should rollback on error and not call save', async () => {
      await expect(
        provider.withTransaction(() => {
          provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'a', 10]);
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');

      const results = provider.queryAll('SELECT * FROM test_items');
      expect(results).toHaveLength(0);
      expect(saveFn).not.toHaveBeenCalled();
    });

    it('should support async functions', async () => {
      await provider.withTransaction(async () => {
        provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['1', 'a', 10]);
        await Promise.resolve();
        provider.run('INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)', ['2', 'b', 20]);
      });

      const results = provider.queryAll('SELECT * FROM test_items');
      expect(results).toHaveLength(2);
    });
  });

  describe('save', () => {
    it('should call the save function', () => {
      provider.save();
      expect(saveFn).toHaveBeenCalledOnce();
    });

    it('should be a no-op when no save function provided', () => {
      const providerNoSave = new SqliteProvider(db);
      expect(() => providerNoSave.save()).not.toThrow();
    });
  });

  describe('close', () => {
    it('should close the underlying database', () => {
      provider.close();
      expect(() => provider.queryAll('SELECT 1')).toThrow();
    });
  });

  describe('db property', () => {
    it('should expose the underlying sql.js database', () => {
      expect(provider.db).toBe(db);
    });
  });
});

describe('ReadOnlySqliteProvider', () => {
  let db: SqlJsDatabase;
  let provider: ReadOnlySqliteProvider;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    db.run(`
      CREATE TABLE IF NOT EXISTS test_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);
    // Pre-populate some data
    db.run("INSERT INTO test_items (id, name, value) VALUES ('1', 'a', 10)");
    db.run("INSERT INTO test_items (id, name, value) VALUES ('2', 'b', 20)");
    provider = new ReadOnlySqliteProvider(db);
  });

  describe('queryAll', () => {
    it('should return all matching rows', () => {
      const results = provider.queryAll<{ id: string; name: string; value: number }>(
        'SELECT * FROM test_items ORDER BY id'
      );
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('a');
    });
  });

  describe('queryOne', () => {
    it('should return the first matching row', () => {
      const result = provider.queryOne<{ name: string }>(
        'SELECT name FROM test_items WHERE id = ?',
        ['1']
      );
      expect(result?.name).toBe('a');
    });
  });

  describe('withTransaction', () => {
    it('should commit on success without saving', async () => {
      await provider.withTransaction(() => {
        provider.run("INSERT INTO test_items (id, name, value) VALUES ('3', 'c', 30)");
      });

      const results = provider.queryAll('SELECT * FROM test_items');
      expect(results).toHaveLength(3);
    });
  });

  describe('db property', () => {
    it('should expose the underlying sql.js database', () => {
      expect(provider.db).toBe(db);
    });
  });
});
