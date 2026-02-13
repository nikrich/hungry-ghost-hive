// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
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

function runMigrations(db: SqlJsDatabase): void {
  // Create migrations table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check if initial migration was applied
  const result = db.exec("SELECT name FROM migrations WHERE name = '001-initial.sql'");
  const initialMigration = result.length > 0 && result[0].values.length > 0;

  if (!initialMigration) {
    // Apply initial migration
    const initialSql = loadMigration('001-initial.sql');
    db.run(initialSql);
    db.run("INSERT INTO migrations (name) VALUES ('001-initial.sql')");
  }

  // Migration 002: Add model column to agents table
  const result002 = db.exec("SELECT name FROM migrations WHERE name = '002-add-agent-model.sql'");
  const migration002Applied = result002.length > 0 && result002[0].values.length > 0;

  if (!migration002Applied) {
    // Check if column already exists (might be new DB with updated initial migration)
    const columns = db.exec('PRAGMA table_info(agents)');
    const hasModelColumn =
      columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === 'model');

    if (!hasModelColumn) {
      const migration002Sql = loadMigration('002-add-agent-model.sql');
      db.run(migration002Sql);
    }
    db.run("INSERT INTO migrations (name) VALUES ('002-add-agent-model.sql')");
  }

  // Migration 003: Fix pull_requests table schema for merge queue
  const result003 = db.exec("SELECT name FROM migrations WHERE name = '003-fix-pull-requests.sql'");
  const migration003Applied = result003.length > 0 && result003[0].values.length > 0;

  if (!migration003Applied) {
    // Check if table needs migration (missing branch_name column)
    const prColumns = db.exec('PRAGMA table_info(pull_requests)');
    const hasBranchName =
      prColumns.length > 0 &&
      prColumns[0].values.some((col: unknown[]) => col[1] === 'branch_name');

    if (!hasBranchName) {
      const migration003Sql = loadMigration('003-fix-pull-requests.sql');
      // Use db.exec() to handle multiple statements with comments properly
      db.exec(migration003Sql);
    }

    db.run("INSERT INTO migrations (name) VALUES ('003-fix-pull-requests.sql')");
  }

  // Migration 004: Add messages table for inter-agent communication
  const result004 = db.exec("SELECT name FROM migrations WHERE name = '004-add-messages.sql'");
  const migration004Applied = result004.length > 0 && result004[0].values.length > 0;

  if (!migration004Applied) {
    // Check if table already exists
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'");
    const hasMessagesTable = tables.length > 0 && tables[0].values.length > 0;

    if (!hasMessagesTable) {
      const migration004Sql = loadMigration('004-add-messages.sql');
      db.run(migration004Sql);
    }

    db.run("INSERT INTO migrations (name) VALUES ('004-add-messages.sql')");
  }

  // Migration 005: Add last_seen column to agents for heartbeat mechanism
  const result005 = db.exec(
    "SELECT name FROM migrations WHERE name = '005-add-agent-last-seen.sql'"
  );
  const migration005Applied = result005.length > 0 && result005[0].values.length > 0;

  if (!migration005Applied) {
    const columns = db.exec('PRAGMA table_info(agents)');
    const hasLastSeenColumn =
      columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === 'last_seen');

    if (!hasLastSeenColumn) {
      // sql.js doesn't support non-constant defaults in ALTER TABLE
      db.run('ALTER TABLE agents ADD COLUMN last_seen TIMESTAMP');
    }
    db.run("INSERT INTO migrations (name) VALUES ('005-add-agent-last-seen.sql')");
  }

  // Migration 006: Add worktree_path column to agents for git worktree isolation
  const result006 = db.exec(
    "SELECT name FROM migrations WHERE name = '006-add-agent-worktree.sql'"
  );
  const migration006Applied = result006.length > 0 && result006[0].values.length > 0;

  if (!migration006Applied) {
    const columns = db.exec('PRAGMA table_info(agents)');
    const hasWorktreePathColumn =
      columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === 'worktree_path');

    if (!hasWorktreePathColumn) {
      db.run('ALTER TABLE agents ADD COLUMN worktree_path TEXT');
    }
    db.run("INSERT INTO migrations (name) VALUES ('006-add-agent-worktree.sql')");
  }

  // Migration 007: Add database indexes for query performance
  const result007 = db.exec("SELECT name FROM migrations WHERE name = '007-add-indexes.sql'");
  const migration007Applied = result007.length > 0 && result007[0].values.length > 0;

  if (!migration007Applied) {
    // Create indexes on frequently-queried columns
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

    db.run("INSERT INTO migrations (name) VALUES ('007-add-indexes.sql')");
  }

  // Migration 008: Add godmode column to requirements table
  const result008 = db.exec("SELECT name FROM migrations WHERE name = '008-add-godmode.sql'");
  const migration008Applied = result008.length > 0 && result008[0].values.length > 0;

  if (!migration008Applied) {
    const columns = db.exec('PRAGMA table_info(requirements)');
    const hasGodmodeColumn =
      columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === 'godmode');

    if (!hasGodmodeColumn) {
      const migration008Sql = loadMigration('008-add-godmode.sql');
      db.run(migration008Sql);
    }
    db.run("INSERT INTO migrations (name) VALUES ('008-add-godmode.sql')");
  }

  // Migration 009: Add pull request sync indexes for faster identifier lookups
  const result009 = db.exec(
    "SELECT name FROM migrations WHERE name = '009-add-pr-sync-indexes.sql'"
  );
  const migration009Applied = result009.length > 0 && result009[0].values.length > 0;

  if (!migration009Applied) {
    const migration009Sql = loadMigration('009-add-pr-sync-indexes.sql');
    // Use db.exec() to handle multiple statements with comments properly
    db.exec(migration009Sql);
    db.run("INSERT INTO migrations (name) VALUES ('009-add-pr-sync-indexes.sql')");
  }

  // Migration 010: Add target_branch column to requirements table
  const result010 = db.exec("SELECT name FROM migrations WHERE name = '010-add-target-branch.sql'");
  const migration010Applied = result010.length > 0 && result010[0].values.length > 0;

  if (!migration010Applied) {
    const columns = db.exec('PRAGMA table_info(requirements)');
    const hasTargetBranchColumn =
      columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === 'target_branch');

    if (!hasTargetBranchColumn) {
      const migration010Sql = loadMigration('010-add-target-branch.sql');
      db.run(migration010Sql);
    }
    db.run("INSERT INTO migrations (name) VALUES ('010-add-target-branch.sql')");
  }

  // Migration 006: Add comprehensive Jira integration fields and sync table
  const result006Jira = db.exec("SELECT name FROM migrations WHERE name = '006-integrations.sql'");
  const migration006JiraApplied = result006Jira.length > 0 && result006Jira[0].values.length > 0;

  if (!migration006JiraApplied) {
    // Add columns to stories table
    const storyColumns = db.exec('PRAGMA table_info(stories)');
    const storyColumnNames =
      storyColumns.length > 0 ? storyColumns[0].values.map((col: unknown[]) => String(col[1])) : [];
    const storyColumnsToAdd = [
      'jira_issue_key',
      'jira_issue_id',
      'jira_project_key',
      'jira_subtask_key',
      'jira_subtask_id',
    ];
    for (const col of storyColumnsToAdd) {
      if (!storyColumnNames.includes(col)) {
        db.run(`ALTER TABLE stories ADD COLUMN ${col} TEXT`);
      }
    }

    // Add columns to requirements table
    const reqColumns = db.exec('PRAGMA table_info(requirements)');
    const reqColumnNames =
      reqColumns.length > 0 ? reqColumns[0].values.map((col: unknown[]) => String(col[1])) : [];
    const reqColumnsToAdd = ['jira_epic_key', 'jira_epic_id'];
    for (const col of reqColumnsToAdd) {
      if (!reqColumnNames.includes(col)) {
        db.run(`ALTER TABLE requirements ADD COLUMN ${col} TEXT`);
      }
    }

    // Add column to pull_requests table
    const prColumns = db.exec('PRAGMA table_info(pull_requests)');
    const prColumnNames =
      prColumns.length > 0 ? prColumns[0].values.map((col: unknown[]) => String(col[1])) : [];
    if (!prColumnNames.includes('jira_issue_key')) {
      db.run('ALTER TABLE pull_requests ADD COLUMN jira_issue_key TEXT');
    }

    // Create integration_sync table
    const syncTables = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='integration_sync'"
    );
    if (syncTables.length === 0 || syncTables[0].values.length === 0) {
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

      // Create indexes on integration_sync table
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

    db.run("INSERT INTO migrations (name) VALUES ('006-integrations.sql')");
  }

  // Migration 011: Add generic provider-agnostic integration fields
  const result011 = db.exec(
    "SELECT name FROM migrations WHERE name = '011-generic-integration-fields.sql'"
  );
  const migration011Applied = result011.length > 0 && result011[0].values.length > 0;

  if (!migration011Applied) {
    // Add generic columns to stories table
    const storyColumns011 = db.exec('PRAGMA table_info(stories)');
    const storyColNames011 =
      storyColumns011.length > 0
        ? storyColumns011[0].values.map((col: unknown[]) => String(col[1]))
        : [];
    const storyGenericCols = [
      'external_issue_key',
      'external_issue_id',
      'external_project_key',
      'external_subtask_key',
      'external_subtask_id',
      'external_provider',
    ];
    for (const col of storyGenericCols) {
      if (!storyColNames011.includes(col)) {
        db.run(`ALTER TABLE stories ADD COLUMN ${col} TEXT`);
      }
    }

    // Add generic columns to requirements table
    const reqColumns011 = db.exec('PRAGMA table_info(requirements)');
    const reqColNames011 =
      reqColumns011.length > 0
        ? reqColumns011[0].values.map((col: unknown[]) => String(col[1]))
        : [];
    const reqGenericCols = ['external_epic_key', 'external_epic_id', 'external_provider'];
    for (const col of reqGenericCols) {
      if (!reqColNames011.includes(col)) {
        db.run(`ALTER TABLE requirements ADD COLUMN ${col} TEXT`);
      }
    }

    // Load and execute the data migration and index creation from file
    const migration011Sql = loadMigration('011-generic-integration-fields.sql');
    // Execute the UPDATE and CREATE INDEX statements (ALTER TABLE already done above)
    const statements = migration011Sql
      .split(';')
      .map(s => s.trim())
      .filter(s => {
        if (s.length === 0) return false;
        // Skip ALTER TABLE statements (already handled above with existence checks)
        if (s.includes('ALTER TABLE')) return false;
        // Filter out pure comment blocks
        const lines = s.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const hasNonCommentLine = lines.some(l => !l.startsWith('--'));
        return hasNonCommentLine;
      });

    for (const stmt of statements) {
      db.run(stmt);
    }

    db.run("INSERT INTO migrations (name) VALUES ('011-generic-integration-fields.sql')");
  }

  // Migration 012: Add in_sprint column and unique constraint on integration_sync
  const result012 = db.exec("SELECT name FROM migrations WHERE name = '012-sprint-tracking.sql'");
  const migration012Applied = result012.length > 0 && result012[0].values.length > 0;

  if (!migration012Applied) {
    // Add in_sprint column to stories table
    const storyColumns012 = db.exec('PRAGMA table_info(stories)');
    const storyColNames012 =
      storyColumns012.length > 0
        ? storyColumns012[0].values.map((col: unknown[]) => String(col[1]))
        : [];

    if (!storyColNames012.includes('in_sprint')) {
      db.run('ALTER TABLE stories ADD COLUMN in_sprint INTEGER DEFAULT 0');
    }

    // Load and execute the index creation from file
    const migration012Sql = loadMigration('012-sprint-tracking.sql');
    // Execute CREATE INDEX statement (ALTER TABLE already done above)
    const statements = migration012Sql
      .split(';')
      .map(s => s.trim())
      .filter(s => {
        if (s.length === 0) return false;
        // Skip ALTER TABLE statements (already handled above)
        if (s.includes('ALTER TABLE')) return false;
        // Filter out pure comment blocks
        const lines = s.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const hasNonCommentLine = lines.some(l => !l.startsWith('--'));
        return hasNonCommentLine;
      });

    for (const stmt of statements) {
      db.run(stmt);
    }

    db.run("INSERT INTO migrations (name) VALUES ('012-sprint-tracking.sql')");
  }

  // Migration 007: Backfill story_points from complexity_score
  const result007Backfill = db.exec(
    "SELECT name FROM migrations WHERE name = '007-backfill-story-points.sql'"
  );
  const migration007BackfillApplied =
    result007Backfill.length > 0 && result007Backfill[0].values.length > 0;

  if (!migration007BackfillApplied) {
    // Backfill story_points from complexity_score where story_points is NULL
    db.run(`
      UPDATE stories
      SET story_points = complexity_score
      WHERE story_points IS NULL
        AND complexity_score IS NOT NULL
    `);
    db.run("INSERT INTO migrations (name) VALUES ('007-backfill-story-points.sql')");
  }
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
  stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row as T);
  }
  stmt.free();
  return results;
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
  type: 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa';
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
  status: 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';
  godmode: number;
  target_branch: string;
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
