// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { DatabaseCorruptionError, InitializationError } from '../errors/index.js';

export interface DatabaseClient {
  db: SqlJsDatabase;
  close: () => void;
  save: () => void;
  runMigrations: () => void;
}

// Embedded initial migration SQL
const INITIAL_MIGRATION = `
-- Hive Orchestrator Initial Schema
-- Version: 1.0

-- Teams
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    repo_url TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa')),
    team_id TEXT REFERENCES teams(id),
    tmux_session TEXT,
    model TEXT,
    status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
    current_story_id TEXT,
    memory_state TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Requirements
CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    submitted_by TEXT DEFAULT 'human',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed')),
    godmode BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stories
CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    requirement_id TEXT REFERENCES requirements(id),
    team_id TEXT REFERENCES teams(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acceptance_criteria TEXT,
    complexity_score INTEGER CHECK (complexity_score BETWEEN 1 AND 13),
    story_points INTEGER,
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft',
        'estimated',
        'planned',
        'in_progress',
        'review',
        'qa',
        'qa_failed',
        'pr_submitted',
        'merged'
    )),
    assigned_agent_id TEXT REFERENCES agents(id),
    branch_name TEXT,
    pr_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Story Dependencies
CREATE TABLE IF NOT EXISTS story_dependencies (
    story_id TEXT REFERENCES stories(id),
    depends_on_story_id TEXT REFERENCES stories(id),
    PRIMARY KEY (story_id, depends_on_story_id)
);

-- Agent Logs (event sourcing - immutable append-only log)
CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    story_id TEXT REFERENCES stories(id),
    event_type TEXT NOT NULL,
    status TEXT,
    message TEXT,
    metadata TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_story ON agent_logs(story_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp);

-- Escalations
CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    story_id TEXT REFERENCES stories(id),
    from_agent_id TEXT REFERENCES agents(id),
    to_agent_id TEXT REFERENCES agents(id),
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
    resolution TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

-- Pull Requests / Merge Queue
CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    story_id TEXT REFERENCES stories(id),
    team_id TEXT REFERENCES teams(id),
    branch_name TEXT NOT NULL,
    github_pr_number INTEGER,
    github_pr_url TEXT,
    submitted_by TEXT,
    reviewed_by TEXT,
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'reviewing', 'approved', 'merged', 'rejected', 'closed')),
    review_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP
);

-- Migrations tracking
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent Messages (for inter-agent communication)
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_session TEXT NOT NULL,
    to_session TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    reply TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'replied')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    replied_at TIMESTAMP
);
`;

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

export async function createDatabase(dbPath: string): Promise<DatabaseClient> {
  const SqlJs = await getSqlJs();
  if (!SqlJs) throw new InitializationError('Failed to initialize sql.js');

  let db: SqlJsDatabase;
  const backupPath = dbPath + '.bak';

  // Load existing database or create new one
  if (existsSync(dbPath)) {
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
    writeFileSync(dbPath, buffer);
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
    db.run(INITIAL_MIGRATION);
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
      db.run('ALTER TABLE agents ADD COLUMN model TEXT');
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
      // SQLite doesn't support ALTER COLUMN or ADD CONSTRAINT, so we need to recreate the table
      db.run(`
        CREATE TABLE pull_requests_new (
          id TEXT PRIMARY KEY,
          story_id TEXT REFERENCES stories(id),
          team_id TEXT REFERENCES teams(id),
          branch_name TEXT NOT NULL DEFAULT '',
          github_pr_number INTEGER,
          github_pr_url TEXT,
          submitted_by TEXT,
          reviewed_by TEXT,
          status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'reviewing', 'approved', 'merged', 'rejected', 'closed')),
          review_notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMP
        )
      `);

      // Copy existing data (map old statuses to new ones)
      db.run(`
        INSERT INTO pull_requests_new (id, story_id, github_pr_number, github_pr_url, status, review_notes, created_at, updated_at)
        SELECT
          id,
          story_id,
          github_pr_number,
          github_pr_url,
          CASE status
            WHEN 'open' THEN 'queued'
            WHEN 'review' THEN 'reviewing'
            ELSE status
          END,
          review_comments,
          created_at,
          updated_at
        FROM pull_requests
      `);

      // Drop old table and rename new one
      db.run('DROP TABLE pull_requests');
      db.run('ALTER TABLE pull_requests_new RENAME TO pull_requests');
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
      db.run(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          from_session TEXT NOT NULL,
          to_session TEXT NOT NULL,
          subject TEXT,
          body TEXT NOT NULL,
          reply TEXT,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'replied')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          replied_at TIMESTAMP
        )
      `);
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
      db.run('ALTER TABLE requirements ADD COLUMN godmode BOOLEAN DEFAULT 0');
    }
    db.run("INSERT INTO migrations (name) VALUES ('008-add-godmode.sql')");
  }

  // Migration 009: Add pull request sync indexes for faster identifier lookups
  const result009 = db.exec(
    "SELECT name FROM migrations WHERE name = '009-add-pr-sync-indexes.sql'"
  );
  const migration009Applied = result009.length > 0 && result009[0].values.length > 0;

  if (!migration009Applied) {
    db.run(
      'CREATE INDEX IF NOT EXISTS idx_pull_requests_status_branch ON pull_requests(status, branch_name)'
    );
    db.run(
      'CREATE INDEX IF NOT EXISTS idx_pull_requests_github_pr_number ON pull_requests(github_pr_number)'
    );
    db.run("INSERT INTO migrations (name) VALUES ('009-add-pr-sync-indexes.sql')");
  }
}

export async function getDatabase(hiveDir: string): Promise<DatabaseClient> {
  const dbPath = join(hiveDir, 'hive.db');
  return createDatabase(dbPath);
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
