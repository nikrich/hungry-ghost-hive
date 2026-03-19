// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import type { WritableDatabaseProvider } from './provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Tables that require workspace_id scoping.
 * The migrations table is intentionally excluded — it is shared across workspaces.
 */
const WORKSPACE_SCOPED_TABLES = new Set([
  'teams',
  'agents',
  'requirements',
  'stories',
  'story_dependencies',
  'agent_logs',
  'escalations',
  'pull_requests',
  'messages',
  'integration_sync',
]);

/**
 * Convert SQLite-style positional parameters (?) to Postgres-style ($1, $2, ...).
 * Handles quoted strings and avoids replacing ? inside string literals.
 */
export function convertParams(sql: string): string {
  let paramIndex = 0;
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prevChar = i > 0 ? sql[i - 1] : '';

    if (char === "'" && !inDoubleQuote && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
      result += char;
    } else if (char === '"' && !inSingleQuote && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      result += char;
    } else if (char === '?' && !inSingleQuote && !inDoubleQuote) {
      paramIndex++;
      result += `$${paramIndex}`;
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Detect the target table from SQL statements.
 * Supports INSERT INTO, UPDATE, DELETE FROM, and SELECT ... FROM patterns.
 */
function detectTable(sql: string): string | null {
  const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  // INSERT INTO table
  let match = normalized.match(/INSERT\s+INTO\s+(\w+)/);
  if (match) return match[1].toLowerCase();

  // UPDATE table
  match = normalized.match(/UPDATE\s+(\w+)/);
  if (match) return match[1].toLowerCase();

  // DELETE FROM table
  match = normalized.match(/DELETE\s+FROM\s+(\w+)/);
  if (match) return match[1].toLowerCase();

  // SELECT ... FROM table (first table in FROM clause)
  match = normalized.match(/FROM\s+(\w+)/);
  if (match) return match[1].toLowerCase();

  return null;
}

/**
 * Detect the alias (or table name) for the primary table in a SQL statement.
 * For `SELECT ... FROM stories s LEFT JOIN ...`, returns "s".
 * For `SELECT ... FROM stories LEFT JOIN ...`, returns "stories".
 * For UPDATE/DELETE, returns the table name or alias.
 */
function detectTableQualifier(sql: string): string | null {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  // SELECT ... FROM table [alias] [JOIN|WHERE|ORDER|GROUP|HAVING|LIMIT|,|)]
  const selectMatch = normalized.match(/FROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (selectMatch) {
    const alias = selectMatch[2];
    const table = selectMatch[1];
    // Only treat as alias if the next word is not a SQL keyword
    if (alias) {
      const upper = alias.toUpperCase();
      const keywords = new Set([
        'WHERE',
        'LEFT',
        'RIGHT',
        'INNER',
        'OUTER',
        'CROSS',
        'JOIN',
        'ON',
        'ORDER',
        'GROUP',
        'HAVING',
        'LIMIT',
        'OFFSET',
        'UNION',
        'EXCEPT',
        'INTERSECT',
        'FOR',
        'SET',
        'VALUES',
      ]);
      if (!keywords.has(upper)) {
        return alias;
      }
    }
    return table;
  }

  // UPDATE table [alias]
  const updateMatch = normalized.match(/UPDATE\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (updateMatch) {
    return updateMatch[2] || updateMatch[1];
  }

  // DELETE FROM table [alias]
  const deleteMatch = normalized.match(/DELETE\s+FROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (deleteMatch) {
    return deleteMatch[2] || deleteMatch[1];
  }

  return null;
}

/**
 * Check if a SQL statement needs workspace_id injection.
 */
function needsWorkspaceScope(sql: string): boolean {
  const table = detectTable(sql);
  return table !== null && WORKSPACE_SCOPED_TABLES.has(table);
}

/**
 * Inject workspace_id into INSERT statements.
 * Transforms: INSERT INTO table (col1, col2) VALUES (?, ?)
 * Into:       INSERT INTO table (col1, col2, workspace_id) VALUES ($1, $2, $3)
 */
function injectInsertWorkspaceId(
  sql: string,
  workspaceId: string,
  params: unknown[]
): { sql: string; params: unknown[] } {
  const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!insertMatch) return { sql, params };

  const columns = insertMatch[2];
  const values = insertMatch[3];

  // Don't inject if workspace_id is already present
  if (columns.toLowerCase().includes('workspace_id')) {
    return { sql, params };
  }

  const newSql = sql.replace(
    /\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    `(${columns}, workspace_id) VALUES (${values}, ?)`
  );

  return { sql: newSql, params: [...params, workspaceId] };
}

/**
 * Inject workspace_id into SELECT/UPDATE/DELETE WHERE clauses.
 * Adds `AND workspace_id = ?` to existing WHERE, or `WHERE workspace_id = ?` if none.
 * When the query uses JOINs, qualifies workspace_id with the primary table alias
 * to avoid ambiguous column references.
 */
function injectWhereWorkspaceId(
  sql: string,
  workspaceId: string,
  params: unknown[]
): { sql: string; params: unknown[] } {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  // Don't inject if workspace_id is already in the query
  if (normalized.toLowerCase().includes('workspace_id')) {
    return { sql, params };
  }

  // Determine if we need to qualify workspace_id (JOIN queries have ambiguous columns)
  const hasJoin = /\bJOIN\b/i.test(normalized);
  const qualifier = hasJoin ? detectTableQualifier(sql) : null;
  const wsCol = qualifier ? `${qualifier}.workspace_id` : 'workspace_id';

  const upperSql = normalized.toUpperCase();

  // Find WHERE clause position
  const whereIndex = upperSql.indexOf(' WHERE ');

  if (whereIndex !== -1) {
    // Append workspace_id condition at the end of the WHERE clause.
    // We must NOT prepend because params are positional — SET clause params
    // come before WHERE clause params, and prepending would shift them.
    const before = normalized.substring(0, whereIndex + 7); // includes " WHERE "
    const after = normalized.substring(whereIndex + 7);

    // Find any trailing clauses (ORDER BY, GROUP BY, etc.) after the WHERE
    const upperAfter = after.toUpperCase();
    const trailingPatterns = [
      ' ORDER BY',
      ' GROUP BY',
      ' HAVING',
      ' LIMIT',
      ' OFFSET',
      ' FOR UPDATE',
    ];
    let trailingPos = after.length;
    for (const pattern of trailingPatterns) {
      const idx = upperAfter.indexOf(pattern);
      if (idx !== -1 && idx < trailingPos) {
        trailingPos = idx;
      }
    }

    const whereBody = after.substring(0, trailingPos);
    const trailing = after.substring(trailingPos);
    return {
      sql: `${before}${whereBody} AND ${wsCol} = ?${trailing}`,
      params: [...params, workspaceId],
    };
  }

  // No WHERE clause — find insertion point (before ORDER BY, GROUP BY, LIMIT, etc.)
  const clausePatterns = [' ORDER BY', ' GROUP BY', ' HAVING', ' LIMIT', ' OFFSET', ' FOR UPDATE'];
  let insertPos = normalized.length;
  for (const pattern of clausePatterns) {
    const idx = upperSql.indexOf(pattern);
    if (idx !== -1 && idx < insertPos) {
      insertPos = idx;
    }
  }

  const before = normalized.substring(0, insertPos);
  const after = normalized.substring(insertPos);

  // Count how many ? appear before the insertion point to determine where
  // in the params array the workspace_id value should be spliced in.
  const questionsBefore = (before.match(/\?/g) || []).length;
  const newParams = [...params];
  newParams.splice(questionsBefore, 0, workspaceId);

  return {
    sql: `${before} WHERE ${wsCol} = ?${after}`,
    params: newParams,
  };
}

/**
 * Load a Postgres migration SQL file.
 */
function loadPgMigration(migrationName: string): string {
  const candidatePaths = [
    join(__dirname, 'pg-migrations', migrationName),
    join(__dirname, '..', '..', 'src', 'db', 'pg-migrations', migrationName),
  ];

  for (const migrationPath of candidatePaths) {
    if (existsSync(migrationPath)) {
      return readFileSync(migrationPath, 'utf-8');
    }
  }

  throw new Error(
    `Postgres migration file not found: ${migrationName}. Checked: ${candidatePaths.join(', ')}`
  );
}

const PG_MIGRATIONS = [{ name: '001-full-schema.sql' }];

/**
 * Strip SQLite-specific syntax that Postgres does not understand.
 */
function sanitizeForPostgres(sql: string): string {
  // Remove COLLATE NOCASE (SQLite case-insensitive collation)
  let result = sql.replace(/\s+COLLATE\s+NOCASE/gi, '');
  // Convert INSERT OR IGNORE to INSERT ... ON CONFLICT DO NOTHING
  result = result.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  return result;
}

/**
 * Postgres implementation of DatabaseProvider using node-postgres (pg).
 * All queries are automatically scoped by workspace_id for multi-tenant isolation.
 */
export class PostgresProvider implements WritableDatabaseProvider {
  private pool: pg.Pool;
  private workspaceId: string;

  constructor(connectionString: string, workspaceId: string) {
    this.pool = new pg.Pool({ connectionString });
    this.workspaceId = workspaceId;
  }

  /**
   * Run Postgres migrations. Idempotent — safe to call multiple times.
   */
  async runMigrations(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Ensure migrations table exists (shared, no workspace_id)
      await client.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      const { rows: applied } = await client.query('SELECT name FROM migrations');
      const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

      for (const migration of PG_MIGRATIONS) {
        if (appliedSet.has(migration.name)) continue;

        const sql = loadPgMigration(migration.name);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    let finalSql = sanitizeForPostgres(sql);
    let finalParams = params;

    if (needsWorkspaceScope(sql)) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();
      if (normalized.startsWith('INSERT')) {
        const result = injectInsertWorkspaceId(finalSql, this.workspaceId, finalParams);
        finalSql = result.sql;
        finalParams = result.params;
      } else {
        const result = injectWhereWorkspaceId(finalSql, this.workspaceId, finalParams);
        finalSql = result.sql;
        finalParams = result.params;
      }
    }

    finalSql = convertParams(finalSql);
    const { rows } = await this.pool.query(finalSql, finalParams);
    return rows as T[];
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const results = await this.queryAll<T>(sql, params);
    return results[0];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    let finalSql = sanitizeForPostgres(sql);
    let finalParams = params;

    if (needsWorkspaceScope(sql)) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();
      if (normalized.startsWith('INSERT')) {
        const result = injectInsertWorkspaceId(finalSql, this.workspaceId, finalParams);
        finalSql = result.sql;
        finalParams = result.params;
      } else {
        const result = injectWhereWorkspaceId(finalSql, this.workspaceId, finalParams);
        finalSql = result.sql;
        finalParams = result.params;
      }
    }

    finalSql = convertParams(finalSql);
    await this.pool.query(finalSql, finalParams);
  }

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (_error) {
        // Ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * No-op for Postgres — data is persisted on every query.
   */
  save(): void {
    // Postgres persists automatically; no explicit save needed
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Test the database connection.
   * @throws if the connection fails
   */
  async testConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  /**
   * Get the workspace_id this provider is scoped to.
   */
  getWorkspaceId(): string {
    return this.workspaceId;
  }
}

/**
 * Create a PostgresProvider from the HIVE_DATABASE_URL environment variable.
 * Loads .env file via dotenv if available.
 */
export async function createPostgresProvider(
  workspaceId: string,
  envPath?: string
): Promise<PostgresProvider> {
  // Load .env file if dotenv is available — use workspace root if provided
  try {
    const dotenv = await import('dotenv');
    if (envPath) {
      dotenv.config({ path: envPath });
    } else {
      dotenv.config();
    }
  } catch {
    // dotenv not available, rely on environment variables
  }

  const connectionString = process.env.HIVE_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'HIVE_DATABASE_URL environment variable is not set. ' +
        'Set it in your environment or in a .env file.'
    );
  }

  const provider = new PostgresProvider(connectionString, workspaceId);
  await provider.testConnection();
  await provider.runMigrations();
  return provider;
}
