// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { DatabaseCorruptionError, InitializationError } from '../errors/index.js';
import { MIGRATIONS } from './migrations/index.js';

export interface DatabaseClient {
  db: SqlJsDatabase;
  close: () => void;
  save: () => void;
  runMigrations: () => void;
}

export interface ReadOnlyDatabaseClient {
  db: SqlJsDatabase;
  close: () => void;
}

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs(): Promise<typeof SQL> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

// Minimum file size (in bytes) that indicates a database had meaningful data.
// Files below this threshold are likely new or schema-only databases.
const CORRUPTION_CHECK_MIN_FILE_SIZE = 50 * 1024; // 50KB

// Core tables that should have rows in a populated database
const CORE_TABLES = ['teams', 'agents', 'stories'];

/**
 * Validate that a loaded database is not a silently-corrupted empty copy.
 * If the source file was large (>50KB) but the loaded DB has core tables
 * with zero rows, that indicates sql.js silently returned an empty DB.
 */
function validateLoadedDatabase(db: SqlJsDatabase, fileSize: number): void {
  if (fileSize < CORRUPTION_CHECK_MIN_FILE_SIZE) {
    return; // Small file — likely a new or schema-only DB, skip validation
  }

  // Check if migrations table exists and has rows — if so, the DB was properly
  // initialized via hive init and the schema is intact. Core tables being empty
  // is expected for a fresh workspace (no teams added yet).
  try {
    const migrationResult = db.exec('SELECT COUNT(*) FROM migrations');
    if (migrationResult.length > 0 && (migrationResult[0].values[0][0] as number) > 0) {
      return; // Migrations ran — DB is properly initialized, just empty of user data
    }
  } catch {
    // migrations table doesn't exist — fall through to core table check
  }

  // Check if any core table has data
  for (const table of CORE_TABLES) {
    try {
      const result = db.exec(`SELECT COUNT(*) FROM ${table}`);
      if (result.length > 0 && (result[0].values[0][0] as number) > 0) {
        return; // At least one core table has data — DB looks valid
      }
    } catch {
      // Table doesn't exist yet — that's fine, migrations haven't run
      continue;
    }
  }

  // File was large but all core tables are empty — likely corruption
  throw new DatabaseCorruptionError(
    `Database file is ${fileSize} bytes but loaded with zero rows in core tables (${CORE_TABLES.join(', ')}). ` +
      'This likely indicates a corrupted or partially-read database file. ' +
      'Refusing to proceed to prevent data loss. Check the backup at hive.db.bak if available.'
  );
}

// Maximum number of attempts when loading a database file that appears corrupted.
// The file may be mid-write by another process (atomic rename not yet completed).
const MAX_LOAD_RETRIES = 3;
// Delay in milliseconds between load retries.
const RETRY_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createDatabase(dbPath: string): Promise<DatabaseClient> {
  const SqlJs = await getSqlJs();
  if (!SqlJs) throw new InitializationError('Failed to initialize sql.js');

  let db!: SqlJsDatabase;
  const backupPath = dbPath + '.bak';

  // Load existing database or create new one
  if (existsSync(dbPath)) {
    // Retry loop: the file may be mid-write by another process
    for (let attempt = 1; attempt <= MAX_LOAD_RETRIES; attempt++) {
      try {
        const buffer = readFileSync(dbPath);
        const fileSize = statSync(dbPath).size;

        try {
          db = new SqlJs.Database(buffer);
          // Verify the database is usable by running a basic command
          db.run('PRAGMA foreign_keys = ON');
          db.exec('SELECT 1');
        } catch (error) {
          throw new DatabaseCorruptionError(
            `Failed to load database file at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Validate the loaded DB is not silently empty from a corrupt file
        validateLoadedDatabase(db, fileSize);

        // Run migrations on loaded DB — wrap in try-catch to detect subtle corruption
        try {
          runMigrations(db);
        } catch (error) {
          throw new DatabaseCorruptionError(
            `Database file at ${dbPath} appears corrupted (migrations failed): ${error instanceof Error ? error.message : String(error)}`
          );
        }

        break; // Load succeeded — exit retry loop
      } catch (error) {
        if (error instanceof DatabaseCorruptionError && attempt < MAX_LOAD_RETRIES) {
          // File may be mid-write by another process; retry after a short delay
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
  } else {
    db = new SqlJs.Database();
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');
    // Run migrations on new DB
    runMigrations(db);
  }

  const save = () => {
    // Write backup before overwriting the main database file
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, backupPath);
    }
    const data = db.export();
    const buffer = Buffer.from(data);
    // Atomic write: write to temp file then rename.
    // rename() is atomic on POSIX filesystems, preventing readers
    // from seeing a truncated/partial file.
    const tmpPath = dbPath + '.tmp';
    writeFileSync(tmpPath, buffer);
    renameSync(tmpPath, dbPath);
  };

  const client: DatabaseClient = {
    db,
    close: () => {
      save();
      db.close();
    },
    save,
    runMigrations: () => {
      runMigrations(db);
      save();
    },
  };

  return client;
}

function runMigrations(db: SqlJsDatabase): void {
  // Create migrations table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Query all applied migrations once
  const appliedResult = db.exec('SELECT name FROM migrations');
  const appliedMigrations = new Set(
    appliedResult.length > 0 ? appliedResult[0].values.map(row => String(row[0])) : []
  );

  // Apply each migration in dependency order
  for (const migration of MIGRATIONS) {
    if (appliedMigrations.has(migration.name)) continue;

    migration.up(db);
    db.run('INSERT INTO migrations (name) VALUES (?)', [migration.name]);
  }
}

/**
 * Returns the status of all known migrations: which are applied and which are pending.
 */
export function getMigrationStatus(db: SqlJsDatabase): Array<{ name: string; applied: boolean }> {
  const appliedResult = db.exec('SELECT name FROM migrations');
  const appliedMigrations = new Set(
    appliedResult.length > 0 ? appliedResult[0].values.map(row => String(row[0])) : []
  );

  return MIGRATIONS.map(m => ({
    name: m.name,
    applied: appliedMigrations.has(m.name),
  }));
}

export async function getDatabase(hiveDir: string): Promise<DatabaseClient> {
  const dbPath = join(hiveDir, 'hive.db');
  return createDatabase(dbPath);
}

export async function getReadOnlyDatabase(hiveDir: string): Promise<ReadOnlyDatabaseClient> {
  const dbPath = join(hiveDir, 'hive.db');
  const SqlJs = await getSqlJs();
  if (!SqlJs) throw new InitializationError('Failed to initialize sql.js');

  if (!existsSync(dbPath)) {
    throw new InitializationError(`Database file not found: ${dbPath}`);
  }

  let db!: SqlJsDatabase;

  for (let attempt = 1; attempt <= MAX_LOAD_RETRIES; attempt++) {
    try {
      const buffer = readFileSync(dbPath);
      const fileSize = statSync(dbPath).size;

      try {
        db = new SqlJs.Database(buffer);
        db.run('PRAGMA foreign_keys = ON');
        db.exec('SELECT 1');
      } catch (error) {
        throw new DatabaseCorruptionError(
          `Failed to load database file at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      validateLoadedDatabase(db, fileSize);

      try {
        runMigrations(db);
      } catch (error) {
        throw new DatabaseCorruptionError(
          `Database file at ${dbPath} appears corrupted (migrations failed): ${error instanceof Error ? error.message : String(error)}`
        );
      }

      break;
    } catch (error) {
      if (error instanceof DatabaseCorruptionError && attempt < MAX_LOAD_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  return {
    db,
    close: () => db.close(),
  };
}

// Helper function to run a query and get results as objects
export function queryAll<T>(db: SqlJsDatabase, sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
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

// Helper function to run a query and get a single result
export function queryOne<T>(db: SqlJsDatabase, sql: string, params: unknown[] = []): T | undefined {
  const results = queryAll<T>(db, sql, params);
  return results[0];
}

// Helper function to run a statement (INSERT, UPDATE, DELETE)
export function run(db: SqlJsDatabase, sql: string, params: unknown[] = []): void {
  db.run(sql, params);
}

/**
 * Execute a function within a database transaction
 * Automatically commits on success, rolls back on error
 * @param db Database instance
 * @param fn Function to execute within transaction
 * @returns Result of the function
 */
export async function withTransaction<T>(db: SqlJsDatabase, fn: () => Promise<T> | T): Promise<T> {
  try {
    db.run('BEGIN IMMEDIATE');
    const result = await fn();
    db.run('COMMIT');
    return result;
  } catch (error) {
    try {
      db.run('ROLLBACK');
    } catch (_error) {
      // Ignore rollback errors - transaction may have already been rolled back
    }
    throw error;
  }
}

// Type definitions for database rows
export interface TeamRow {
  id: string;
  repo_url: string;
  repo_path: string;
  name: string;
  created_at: string;
}

export interface AgentRow {
  id: string;
  type: 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa' | 'feature_test';
  team_id: string | null;
  tmux_session: string | null;
  model: string | null;
  status: 'idle' | 'working' | 'blocked' | 'terminated';
  current_story_id: string | null;
  memory_state: string | null;
  last_seen: string | null;
  cli_tool: string;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequirementRow {
  id: string;
  title: string;
  description: string;
  submitted_by: string;
  status:
    | 'pending'
    | 'planning'
    | 'planned'
    | 'in_progress'
    | 'completed'
    | 'sign_off'
    | 'sign_off_failed'
    | 'sign_off_passed';
  godmode: number;
  target_branch: string;
  feature_branch: string | null;
  /** @deprecated Use external_epic_key instead */
  jira_epic_key: string | null;
  /** @deprecated Use external_epic_id instead */
  jira_epic_id: string | null;
  external_epic_key: string | null;
  external_epic_id: string | null;
  external_provider: string | null;
  created_at: string;
}

export interface StoryRow {
  id: string;
  requirement_id: string | null;
  team_id: string | null;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  complexity_score: number | null;
  story_points: number | null;
  status:
    | 'draft'
    | 'estimated'
    | 'planned'
    | 'in_progress'
    | 'review'
    | 'qa'
    | 'qa_failed'
    | 'pr_submitted'
    | 'merged';
  assigned_agent_id: string | null;
  branch_name: string | null;
  pr_url: string | null;
  /** @deprecated Use external_issue_key instead */
  jira_issue_key: string | null;
  /** @deprecated Use external_issue_id instead */
  jira_issue_id: string | null;
  /** @deprecated Use external_project_key instead */
  jira_project_key: string | null;
  /** @deprecated Use external_subtask_key instead */
  jira_subtask_key: string | null;
  /** @deprecated Use external_subtask_id instead */
  jira_subtask_id: string | null;
  external_issue_key: string | null;
  external_issue_id: string | null;
  external_project_key: string | null;
  external_subtask_key: string | null;
  external_subtask_id: string | null;
  external_provider: string | null;
  in_sprint: number;
  created_at: string;
  updated_at: string;
}

export interface AgentLogRow {
  id: number;
  agent_id: string;
  story_id: string | null;
  event_type: string;
  status: string | null;
  message: string | null;
  metadata: string | null;
  timestamp: string;
}

export interface EscalationRow {
  id: string;
  story_id: string | null;
  from_agent_id: string | null;
  to_agent_id: string | null;
  reason: string;
  status: 'pending' | 'acknowledged' | 'resolved';
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PullRequestRow {
  id: string;
  story_id: string | null;
  team_id: string | null;
  branch_name: string;
  github_pr_number: number | null;
  github_pr_url: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  status: 'queued' | 'reviewing' | 'approved' | 'merged' | 'rejected' | 'closed';
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}
