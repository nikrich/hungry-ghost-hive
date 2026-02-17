// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { InitializationError } from '../errors/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DatabaseClient {
  db: Database.Database;
  close: () => void;
  runMigrations: () => void;
}

export interface ReadOnlyDatabaseClient {
  db: Database.Database;
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

export async function createDatabase(dbPath: string): Promise<DatabaseClient> {
  let db: Database.Database;

  try {
    db = new Database(dbPath);
  } catch (error) {
    throw new InitializationError(
      `Failed to open database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Enable WAL mode for concurrent access and better performance
  db.pragma('journal_mode = WAL');
  // Set busy timeout for lock contention (5 second retry on lock)
  db.pragma('busy_timeout = 5000');
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  const client: DatabaseClient = {
    db,
    close: () => {
      db.close();
    },
    runMigrations: () => {
      runMigrations(db);
    },
  };

  return client;
}

/** Helper: check if a column exists on a table */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  return columns.some(col => col.name === column);
}

/** Helper: check if a table exists */
function hasTable(db: Database.Database, table: string): boolean {
  const result = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name: string } | undefined;
  return result !== undefined;
}

/** Helper: get all column names for a table */
function getColumnNames(db: Database.Database, table: string): string[] {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  return columns.map(col => col.name);
}

/**
 * Helper: execute SQL from a migration file, optionally skipping ALTER TABLE
 * statements (when columns are added with existence checks above).
 */
function execMigrationSqlStatements(
  db: Database.Database,
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
    db.exec(stmt);
  }
}

interface MigrationDefinition {
  name: string;
  up: (db: Database.Database) => void;
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
      db.exec(sql);
    },
  },
  {
    name: '002-add-agent-model.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'model')) {
        const sql = loadMigration('002-add-agent-model.sql');
        db.exec(sql);
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
        db.exec(sql);
      }
    },
  },
  {
    name: '005-add-agent-last-seen.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'last_seen')) {
        db.exec('ALTER TABLE agents ADD COLUMN last_seen TIMESTAMP');
      }
    },
  },
  {
    name: '006-add-agent-worktree.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'worktree_path')) {
        db.exec('ALTER TABLE agents ADD COLUMN worktree_path TEXT');
      }
    },
  },
  {
    name: '007-add-indexes.sql',
    up: db => {
      db.exec('CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_stories_team_id ON stories(team_id)');
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_stories_assigned_agent_id ON stories(assigned_agent_id)'
      );
      db.exec('CREATE INDEX IF NOT EXISTS idx_stories_requirement_id ON stories(requirement_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)');
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_pull_requests_team_status ON pull_requests(team_id, status)'
      );
      db.exec('CREATE INDEX IF NOT EXISTS idx_pull_requests_story_id ON pull_requests(story_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_messages_to_session ON messages(to_session)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status)');
    },
  },
  {
    name: '008-add-godmode.sql',
    up: db => {
      if (!hasColumn(db, 'requirements', 'godmode')) {
        const sql = loadMigration('008-add-godmode.sql');
        db.exec(sql);
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
        db.exec(sql);
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
          db.exec(`ALTER TABLE stories ADD COLUMN ${col} TEXT`);
        }
      }

      // Add columns to requirements table
      const reqColumnNames = getColumnNames(db, 'requirements');
      for (const col of ['jira_epic_key', 'jira_epic_id']) {
        if (!reqColumnNames.includes(col)) {
          db.exec(`ALTER TABLE requirements ADD COLUMN ${col} TEXT`);
        }
      }

      // Add column to pull_requests table
      if (!hasColumn(db, 'pull_requests', 'jira_issue_key')) {
        db.exec('ALTER TABLE pull_requests ADD COLUMN jira_issue_key TEXT');
      }

      // Create integration_sync table
      if (!hasTable(db, 'integration_sync')) {
        db.exec(`
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
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_entity ON integration_sync(entity_type, entity_id)'
        );
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_provider ON integration_sync(provider, external_id)'
        );
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_integration_sync_status ON integration_sync(sync_status)'
        );
        db.exec(
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
          db.exec(`ALTER TABLE stories ADD COLUMN ${col} TEXT`);
        }
      }

      // Add generic columns to requirements table
      const reqColNames = getColumnNames(db, 'requirements');
      for (const col of ['external_epic_key', 'external_epic_id', 'external_provider']) {
        if (!reqColNames.includes(col)) {
          db.exec(`ALTER TABLE requirements ADD COLUMN ${col} TEXT`);
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
        db.exec('ALTER TABLE stories ADD COLUMN in_sprint INTEGER DEFAULT 0');
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
        db.exec(sql);
      }

      // Recreate agents table with updated type CHECK constraint (add 'feature_test')
      db.exec('PRAGMA foreign_keys = OFF');

      db.exec(`
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
      db.exec('INSERT INTO agents_new SELECT * FROM agents');
      db.exec('DROP TABLE agents');
      db.exec('ALTER TABLE agents_new RENAME TO agents');

      db.exec('CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)');

      // Recreate requirements table with updated status CHECK constraint
      db.exec(`
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
      db.exec(`
        INSERT INTO requirements_new (id, title, description, submitted_by, status, godmode, target_branch, feature_branch, jira_epic_key, jira_epic_id, external_epic_key, external_epic_id, external_provider, created_at)
        SELECT id, title, description, submitted_by, status, godmode, target_branch, feature_branch, jira_epic_key, jira_epic_id, external_epic_key, external_epic_id, external_provider, created_at
        FROM requirements
      `);
      db.exec('DROP TABLE requirements');
      db.exec('ALTER TABLE requirements_new RENAME TO requirements');

      db.pragma('foreign_keys = ON');
    },
  },
  {
    name: '007-backfill-story-points.sql',
    up: db => {
      db.exec(`
        UPDATE stories
        SET story_points = complexity_score
        WHERE story_points IS NULL
          AND complexity_score IS NOT NULL
      `);
    },
  },
];

function runMigrations(db: Database.Database): void {
  // Create migrations table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Query all applied migrations once
  const appliedRows = db.prepare('SELECT name FROM migrations').all() as { name: string }[];
  const appliedMigrations = new Set(appliedRows.map(row => row.name));

  for (const migration of MIGRATIONS) {
    if (appliedMigrations.has(migration.name)) continue;
    migration.up(db);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
  }
}

/**
 * Returns the status of all migrations (applied vs pending).
 * Useful for debugging migration issues.
 */
export function getMigrationStatus(
  db: Database.Database
): { name: string; applied: boolean }[] {
  const appliedRows = db.prepare('SELECT name FROM migrations').all() as { name: string }[];
  const appliedMigrations = new Set(appliedRows.map(row => row.name));

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

  if (!existsSync(dbPath)) {
    throw new InitializationError(`Database file not found: ${dbPath}`);
  }

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (error) {
    throw new InitializationError(
      `Failed to open read-only database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return {
    db,
    close: () => db.close(),
  };
}

// Helper function to run a query and get results as objects
export function queryAll<T>(db: Database.Database, sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

// Helper function to run a query and get a single result
export function queryOne<T>(
  db: Database.Database,
  sql: string,
  params: unknown[] = []
): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

// Helper function to run a statement (INSERT, UPDATE, DELETE)
export function run(db: Database.Database, sql: string, params: unknown[] = []): void {
  db.prepare(sql).run(...params);
}

/**
 * Execute a function within a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * With better-sqlite3, writes are automatically persisted to disk
 * via WAL mode — no manual save step is needed.
 *
 * @param db Database instance
 * @param fn Function to execute within transaction
 * @returns Result of the function
 */
export async function withTransaction<T>(
  db: Database.Database,
  fn: () => Promise<T> | T
): Promise<T> {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
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
