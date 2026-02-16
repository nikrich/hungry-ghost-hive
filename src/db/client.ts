// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { fileURLToPath } from 'url';
import { DatabaseCorruptionError, InitializationError } from '../errors/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

/**
 * Load migration SQL from file
 * @param migrationName Name of the migration file (e.g., '001-initial.sql')
 * @returns SQL content of the migration file
 */
function loadMigration(migrationName: string): string {
  const migrationPath = join(__dirname, 'migrations', migrationName);
  return readFileSync(migrationPath, 'utf-8');
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

/** Helper: check if a column exists on a table */
function hasColumn(db: SqlJsDatabase, table: string, column: string): boolean {
  const columns = db.exec(`PRAGMA table_info(${table})`);
  return columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === column);
}

/** Helper: check if a table exists */
function hasTable(db: SqlJsDatabase, table: string): boolean {
  const tables = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
  return tables.length > 0 && tables[0].values.length > 0;
}

/** Helper: get all column names for a table */
function getColumnNames(db: SqlJsDatabase, table: string): string[] {
  const columns = db.exec(`PRAGMA table_info(${table})`);
  return columns.length > 0 ? columns[0].values.map((col: unknown[]) => String(col[1])) : [];
}

/**
 * Helper: execute SQL from a migration file, optionally skipping ALTER TABLE
 * statements (when columns are added with existence checks above).
 */
function execMigrationSqlStatements(
  db: SqlJsDatabase,
  sql: string,
  opts?: { skipAlterTable?: boolean }
): void {
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => {
      if (s.length === 0) return false;
      if (opts?.skipAlterTable && s.includes('ALTER TABLE')) return false;
      const lines = s
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      return lines.some(l => !l.startsWith('--'));
    });
  for (const stmt of statements) {
    db.run(stmt);
  }
}

interface MigrationDefinition {
  name: string;
  up: (db: SqlJsDatabase) => void;
}

/**
 * Migration definitions in execution order.
 * Note: Some migrations are numbered out of sequence (e.g. 006-integrations runs after 010,
 * 007-backfill runs last) to preserve the original execution order for backward compatibility.
 */
const MIGRATIONS: MigrationDefinition[] = [
  {
    name: '001-initial.sql',
    up: db => {
      const sql = loadMigration('001-initial.sql');
      db.run(sql);
    },
  },
  {
    name: '002-add-agent-model.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'model')) {
        const sql = loadMigration('002-add-agent-model.sql');
        db.run(sql);
      }
    },
  },
  {
    name: '003-fix-pull-requests.sql',
    up: db => {
      if (!hasColumn(db, 'pull_requests', 'branch_name')) {
        const sql = loadMigration('003-fix-pull-requests.sql');
        db.exec(sql);
      }
    },
  },
  {
    name: '004-add-messages.sql',
    up: db => {
      if (!hasTable(db, 'messages')) {
        const sql = loadMigration('004-add-messages.sql');
        db.run(sql);
      }
    },
  },
  {
    name: '005-add-agent-last-seen.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'last_seen')) {
        db.run('ALTER TABLE agents ADD COLUMN last_seen TIMESTAMP');
      }
    },
  },
  {
    name: '006-add-agent-worktree.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'worktree_path')) {
        db.run('ALTER TABLE agents ADD COLUMN worktree_path TEXT');
      }
    },
  },
  {
    name: '007-add-indexes.sql',
    up: db => {
      db.run('CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status)');
      db.run('CREATE INDEX IF NOT EXISTS idx_stories_team_id ON stories(team_id)');
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_stories_assigned_agent_id ON stories(assigned_agent_id)'
      );
      db.run('CREATE INDEX IF NOT EXISTS idx_stories_requirement_id ON stories(requirement_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)');
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_pull_requests_team_status ON pull_requests(team_id, status)'
      );
      db.run('CREATE INDEX IF NOT EXISTS idx_pull_requests_story_id ON pull_requests(story_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_messages_to_session ON messages(to_session)');
      db.run('CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status)');
    },
  },
  {
    name: '008-add-godmode.sql',
    up: db => {
      if (!hasColumn(db, 'requirements', 'godmode')) {
        const sql = loadMigration('008-add-godmode.sql');
        db.run(sql);
      }
    },
  },
  {
    name: '009-add-pr-sync-indexes.sql',
    up: db => {
      const sql = loadMigration('009-add-pr-sync-indexes.sql');
      db.exec(sql);
    },
  },
  {
    name: '010-add-target-branch.sql',
    up: db => {
      if (!hasColumn(db, 'requirements', 'target_branch')) {
        const sql = loadMigration('010-add-target-branch.sql');
        db.run(sql);
      }
    },
  },
  {
    name: '006-integrations.sql',
    up: db => {
      // Add columns to stories table
      const storyColumnNames = getColumnNames(db, 'stories');
      for (const col of [
        'jira_issue_key',
        'jira_issue_id',
        'jira_project_key',
        'jira_subtask_key',
        'jira_subtask_id',
      ]) {
        if (!storyColumnNames.includes(col)) {
          db.run(`ALTER TABLE stories ADD COLUMN ${col} TEXT`);
        }
      }

      // Add columns to requirements table
      const reqColumnNames = getColumnNames(db, 'requirements');
      for (const col of ['jira_epic_key', 'jira_epic_id']) {
        if (!reqColumnNames.includes(col)) {
          db.run(`ALTER TABLE requirements ADD COLUMN ${col} TEXT`);
        }
      }

      // Add column to pull_requests table
      if (!hasColumn(db, 'pull_requests', 'jira_issue_key')) {
        db.run('ALTER TABLE pull_requests ADD COLUMN jira_issue_key TEXT');
      }

      // Create integration_sync table
      if (!hasTable(db, 'integration_sync')) {
        db.run(`
          CREATE TABLE integration_sync (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL CHECK (entity_type IN ('story', 'requirement', 'pull_request')),
            entity_id TEXT NOT NULL,
            provider TEXT NOT NULL CHECK (provider IN ('jira', 'github', 'confluence')),
            external_id TEXT NOT NULL,
            last_synced_at TIMESTAMP,
            sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        db.run(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_entity ON integration_sync(entity_type, entity_id)'
        );
        db.run(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_provider ON integration_sync(provider, external_id)'
        );
        db.run(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_status ON integration_sync(sync_status)'
        );
        db.run(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_last_synced ON integration_sync(last_synced_at)'
        );
      }
    },
  },
  {
    name: '011-generic-integration-fields.sql',
    up: db => {
      // Add generic columns to stories table
      const storyColNames = getColumnNames(db, 'stories');
      for (const col of [
        'external_issue_key',
        'external_issue_id',
        'external_project_key',
        'external_subtask_key',
        'external_subtask_id',
        'external_provider',
      ]) {
        if (!storyColNames.includes(col)) {
          db.run(`ALTER TABLE stories ADD COLUMN ${col} TEXT`);
        }
      }

      // Add generic columns to requirements table
      const reqColNames = getColumnNames(db, 'requirements');
      for (const col of ['external_epic_key', 'external_epic_id', 'external_provider']) {
        if (!reqColNames.includes(col)) {
          db.run(`ALTER TABLE requirements ADD COLUMN ${col} TEXT`);
        }
      }

      // Execute UPDATE and CREATE INDEX statements from the migration file
      const sql = loadMigration('011-generic-integration-fields.sql');
      execMigrationSqlStatements(db, sql, { skipAlterTable: true });
    },
  },
  {
    name: '012-sprint-tracking.sql',
    up: db => {
      if (!hasColumn(db, 'stories', 'in_sprint')) {
        db.run('ALTER TABLE stories ADD COLUMN in_sprint INTEGER DEFAULT 0');
      }

      const sql = loadMigration('012-sprint-tracking.sql');
      execMigrationSqlStatements(db, sql, { skipAlterTable: true });
    },
  },
  {
    name: '013-feature-testing-support.sql',
    up: db => {
      // Add feature_branch column to requirements
      if (!hasColumn(db, 'requirements', 'feature_branch')) {
        const sql = loadMigration('013-feature-testing-support.sql');
        db.run(sql);
      }

      // Recreate agents table with updated type CHECK constraint (add 'feature_test')
      db.run('PRAGMA foreign_keys = OFF');

      db.run(`
        CREATE TABLE agents_new (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa', 'feature_test')),
          team_id TEXT REFERENCES teams(id),
          tmux_session TEXT,
          model TEXT,
          status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
          current_story_id TEXT,
          memory_state TEXT,
          last_seen TIMESTAMP,
          worktree_path TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run('INSERT INTO agents_new SELECT * FROM agents');
      db.run('DROP TABLE agents');
      db.run('ALTER TABLE agents_new RENAME TO agents');

      db.run('CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)');

      // Recreate requirements table with updated status CHECK constraint
      db.run(`
        CREATE TABLE requirements_new (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          submitted_by TEXT DEFAULT 'human',
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed', 'sign_off', 'sign_off_failed', 'sign_off_passed')),
          godmode BOOLEAN DEFAULT 0,
          target_branch TEXT DEFAULT 'main',
          feature_branch TEXT,
          jira_epic_key TEXT,
          jira_epic_id TEXT,
          external_epic_key TEXT,
          external_epic_id TEXT,
          external_provider TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.run(`
        INSERT INTO requirements_new (id, title, description, submitted_by, status, godmode, target_branch, feature_branch, jira_epic_key, jira_epic_id, external_epic_key, external_epic_id, external_provider, created_at)
        SELECT id, title, description, submitted_by, status, godmode, target_branch, feature_branch, jira_epic_key, jira_epic_id, external_epic_key, external_epic_id, external_provider, created_at
        FROM requirements
      `);
      db.run('DROP TABLE requirements');
      db.run('ALTER TABLE requirements_new RENAME TO requirements');

      db.run('PRAGMA foreign_keys = ON');
    },
  },
  {
    name: '007-backfill-story-points.sql',
    up: db => {
      db.run(`
        UPDATE stories
        SET story_points = complexity_score
        WHERE story_points IS NULL
          AND complexity_score IS NOT NULL
      `);
    },
  },
];

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
    appliedResult.length > 0 ? appliedResult[0].values.map((row: unknown[]) => String(row[0])) : []
  );

  for (const migration of MIGRATIONS) {
    if (appliedMigrations.has(migration.name)) continue;
    migration.up(db);
    db.run('INSERT INTO migrations (name) VALUES (?)', [migration.name]);
  }
}

/**
 * Returns the status of all migrations (applied vs pending).
 * Useful for debugging migration issues.
 */
export function getMigrationStatus(db: SqlJsDatabase): { name: string; applied: boolean }[] {
  const appliedResult = db.exec('SELECT name FROM migrations');
  const appliedMigrations = new Set(
    appliedResult.length > 0 ? appliedResult[0].values.map((row: unknown[]) => String(row[0])) : []
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
 * Execute a function within a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * **Important:** With sql.js, committing a transaction only updates the in-memory
 * database. You should provide a `saveFn` to persist changes to disk after commit,
 * or explicitly call `db.save()` after this function returns. Omitting persistence
 * risks data loss if the process crashes.
 *
 * @param db Database instance
 * @param fn Function to execute within transaction
 * @param saveFn Optional function to persist the database to disk after a successful commit
 * @returns Result of the function
 */
export async function withTransaction<T>(
  db: SqlJsDatabase,
  fn: () => Promise<T> | T,
  saveFn?: () => void
): Promise<T> {
  try {
    db.run('BEGIN IMMEDIATE');
    const result = await fn();
    db.run('COMMIT');
    if (saveFn) {
      saveFn();
    }
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

/**
 * Convenience wrapper that executes a function within a database transaction
 * and automatically persists to disk after a successful commit.
 *
 * @param db Database instance
 * @param saveFn Function to persist the database to disk (e.g., `() => db.save()`)
 * @param fn Function to execute within transaction
 * @returns Result of the function
 */
export async function withTransactionAndSave<T>(
  db: SqlJsDatabase,
  saveFn: () => void,
  fn: () => Promise<T> | T
): Promise<T> {
  return withTransaction(db, fn, saveFn);
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
