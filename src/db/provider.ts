// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database as SqlJsDatabase } from 'sql.js';

/**
 * Database provider abstraction.
 * All query modules use this interface instead of sql.js Database directly.
 * The SQLite implementation wraps sql.js; a Postgres implementation can
 * translate `?` placeholders to `$1,$2,...` internally.
 */
export interface DatabaseProvider {
  queryAll<T>(sql: string, params?: unknown[]): T[];
  queryOne<T>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): void;

  /** Release the underlying connection/resources. */
  close(): void;

  /**
   * Execute a function within a database transaction.
   * Automatically commits on success, rolls back on error.
   * @param fn Function to execute within the transaction
   * @param saveFn Optional function to persist changes after commit (SQLite-specific)
   */
  withTransaction<T>(fn: () => Promise<T> | T, saveFn?: () => void): Promise<T>;
}

/**
 * SQLite implementation of DatabaseProvider backed by sql.js.
 */
export class SqliteProvider implements DatabaseProvider {
  constructor(public readonly db: SqlJsDatabase) {}

  queryAll<T>(sql: string, params: unknown[] = []): T[] {
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

  queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    const results = this.queryAll<T>(sql, params);
    return results[0];
  }

  run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params);
  }

  close(): void {
    this.db.close();
  }

  async withTransaction<T>(fn: () => Promise<T> | T, saveFn?: () => void): Promise<T> {
    try {
      this.db.run('BEGIN IMMEDIATE');
      const result = await fn();
      this.db.run('COMMIT');
      if (saveFn) {
        saveFn();
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
}
