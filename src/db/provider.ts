// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database as SqlJsDatabase } from 'sql.js';

/**
 * Abstract database provider interface that supports both SQLite and Postgres backends.
 * All methods are async to support inherently asynchronous backends like Postgres.
 */
export interface DatabaseProvider {
  queryAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>;
  close(): Promise<void>;
}

/**
 * Extended provider for writable database connections that support persistence.
 */
export interface WritableDatabaseProvider extends DatabaseProvider {
  save(): void;
}

/**
 * Result type for query operations (useful for Postgres which returns metadata).
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/**
 * SQLite implementation of DatabaseProvider using sql.js.
 * Wraps an in-memory sql.js Database with the provider interface.
 * Methods return resolved Promises wrapping synchronous sql.js operations.
 */
export class SqliteProvider implements WritableDatabaseProvider {
  /**
   * Direct access to the underlying sql.js Database.
   * Exposed for backward compatibility during the migration period.
   * New code should use the provider methods instead.
   */
  public readonly db: SqlJsDatabase;

  private _saveFn: (() => void) | undefined;

  constructor(db: SqlJsDatabase, saveFn?: () => void) {
    this.db = db;
    this._saveFn = saveFn;
  }

  async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);

      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row as T);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const results = await this.queryAll<T>(sql, params);
    return results[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.run(sql, params);
  }

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    try {
      this.db.run('BEGIN IMMEDIATE');
      const result = await fn();
      this.db.run('COMMIT');
      if (this._saveFn) {
        this._saveFn();
      }
      return result;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch (_error) {
        // Ignore rollback errors - transaction may have already been rolled back
      }
      throw error;
    }
  }

  save(): void {
    if (this._saveFn) {
      this._saveFn();
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * Read-only SQLite provider that does not support save operations.
 */
export class ReadOnlySqliteProvider implements DatabaseProvider {
  public readonly db: SqlJsDatabase;

  constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);

      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row as T);
      }
      return results;
    } finally {
      stmt.free();
    }
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const results = await this.queryAll<T>(sql, params);
    return results[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.run(sql, params);
  }

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    try {
      this.db.run('BEGIN IMMEDIATE');
      const result = await fn();
      this.db.run('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.run('ROLLBACK');
      } catch (_error) {
        // Ignore rollback errors
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
