// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { Database as SqlJsDatabase } from 'sql.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MigrationDefinition {
  name: string;
  up: (db: SqlJsDatabase) => void;
}

function loadMigrationSql(migrationName: string): string {
  const migrationPath = join(__dirname, migrationName);
  return readFileSync(migrationPath, 'utf-8');
}

/** Check if a column exists on a table */
function hasColumn(db: SqlJsDatabase, table: string, column: string): boolean {
  const columns = db.exec(`PRAGMA table_info(${table})`);
  return columns.length > 0 && columns[0].values.some((col: unknown[]) => col[1] === column);
}

/** Get all column names for a table */
function getColumnNames(db: SqlJsDatabase, table: string): string[] {
  const columns = db.exec(`PRAGMA table_info(${table})`);
  return columns.length > 0 ? columns[0].values.map((col: unknown[]) => String(col[1])) : [];
}

/** Check if a table exists */
function hasTable(db: SqlJsDatabase, tableName: string): boolean {
  const tables = db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
  );
  return tables.length > 0 && tables[0].values.length > 0;
}

/**
 * Filter SQL file into executable statements, skipping ALTER TABLE and pure comment blocks.
 * Used for migrations that handle ALTER TABLE separately with existence checks.
 */
function execNonAlterStatements(db: SqlJsDatabase, sql: string): void {
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => {
      if (s.length === 0) return false;
      if (s.includes('ALTER TABLE')) return false;
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

/** Add columns to a table if they don't already exist */
function addColumnsIfMissing(
  db: SqlJsDatabase,
  table: string,
  columns: Array<{ name: string; type: string }>
): void {
  const existing = getColumnNames(db, table);
  for (const col of columns) {
    if (!existing.includes(col.name)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
    }
  }
}

/**
 * All migrations in dependency order.
 *
 * Note: The numbering is historical and inconsistent (e.g., 006-integrations runs
 * after 010, 007-backfill runs last). The array order reflects the actual
 * dependency order that must be preserved for correctness.
 */
export const MIGRATIONS: MigrationDefinition[] = [
  {
    name: '001-initial.sql',
    up: db => {
      db.run(loadMigrationSql('001-initial.sql'));
    },
  },
  {
    name: '002-add-agent-model.sql',
    up: db => {
      if (!hasColumn(db, 'agents', 'model')) {
        db.run(loadMigrationSql('002-add-agent-model.sql'));
      }
    },
  },
  {
    name: '003-fix-pull-requests.sql',
    up: db => {
      if (!hasColumn(db, 'pull_requests', 'branch_name')) {
        db.exec(loadMigrationSql('003-fix-pull-requests.sql'));
      }
    },
  },
  {
    name: '004-add-messages.sql',
    up: db => {
      if (!hasTable(db, 'messages')) {
        db.run(loadMigrationSql('004-add-messages.sql'));
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
        db.run(loadMigrationSql('008-add-godmode.sql'));
      }
    },
  },
  {
    name: '009-add-pr-sync-indexes.sql',
    up: db => {
      db.exec(loadMigrationSql('009-add-pr-sync-indexes.sql'));
    },
  },
  {
    name: '010-add-target-branch.sql',
    up: db => {
      if (!hasColumn(db, 'requirements', 'target_branch')) {
        db.run(loadMigrationSql('010-add-target-branch.sql'));
      }
    },
  },
  {
    name: '006-integrations.sql',
    up: db => {
      // Add columns to stories table
      addColumnsIfMissing(db, 'stories', [
        { name: 'jira_issue_key', type: 'TEXT' },
        { name: 'jira_issue_id', type: 'TEXT' },
        { name: 'jira_project_key', type: 'TEXT' },
        { name: 'jira_subtask_key', type: 'TEXT' },
        { name: 'jira_subtask_id', type: 'TEXT' },
      ]);

      // Add columns to requirements table
      addColumnsIfMissing(db, 'requirements', [
        { name: 'jira_epic_key', type: 'TEXT' },
        { name: 'jira_epic_id', type: 'TEXT' },
      ]);

      // Add column to pull_requests table
      addColumnsIfMissing(db, 'pull_requests', [{ name: 'jira_issue_key', type: 'TEXT' }]);

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
      addColumnsIfMissing(db, 'stories', [
        { name: 'external_issue_key', type: 'TEXT' },
        { name: 'external_issue_id', type: 'TEXT' },
        { name: 'external_project_key', type: 'TEXT' },
        { name: 'external_subtask_key', type: 'TEXT' },
        { name: 'external_subtask_id', type: 'TEXT' },
        { name: 'external_provider', type: 'TEXT' },
      ]);

      // Add generic columns to requirements table
      addColumnsIfMissing(db, 'requirements', [
        { name: 'external_epic_key', type: 'TEXT' },
        { name: 'external_epic_id', type: 'TEXT' },
        { name: 'external_provider', type: 'TEXT' },
      ]);

      // Execute UPDATE and CREATE INDEX statements from the SQL file
      execNonAlterStatements(db, loadMigrationSql('011-generic-integration-fields.sql'));
    },
  },
  {
    name: '012-sprint-tracking.sql',
    up: db => {
      addColumnsIfMissing(db, 'stories', [{ name: 'in_sprint', type: 'INTEGER DEFAULT 0' }]);

      // Execute CREATE INDEX statements from the SQL file
      execNonAlterStatements(db, loadMigrationSql('012-sprint-tracking.sql'));
    },
  },
  {
    name: '013-feature-testing-support.sql',
    up: db => {
      // 1. Add feature_branch column to requirements
      if (!hasColumn(db, 'requirements', 'feature_branch')) {
        db.run(loadMigrationSql('013-feature-testing-support.sql'));
      }

      // 2. Recreate agents table with updated type CHECK constraint (add 'feature_test')
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

      // Recreate agents indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)');

      // 3. Recreate requirements table with updated status CHECK constraint
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
