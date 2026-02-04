import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
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

-- Pull Requests
CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    story_id TEXT REFERENCES stories(id),
    github_pr_number INTEGER,
    github_pr_url TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'review', 'approved', 'merged', 'closed')),
    review_comments TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
let SQL = null;
async function getSqlJs() {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    return SQL;
}
export async function createDatabase(dbPath) {
    const SqlJs = await getSqlJs();
    if (!SqlJs)
        throw new Error('Failed to initialize sql.js');
    let db;
    // Load existing database or create new one
    if (existsSync(dbPath)) {
        const buffer = readFileSync(dbPath);
        db = new SqlJs.Database(buffer);
    }
    else {
        db = new SqlJs.Database();
    }
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');
    const save = () => {
        const data = db.export();
        const buffer = Buffer.from(data);
        writeFileSync(dbPath, buffer);
    };
    const client = {
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
function runMigrations(db) {
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
}
export async function getDatabase(hiveDir) {
    const dbPath = join(hiveDir, 'hive.db');
    return createDatabase(dbPath);
}
// Helper function to run a query and get results as objects
export function queryAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row);
    }
    stmt.free();
    return results;
}
// Helper function to run a query and get a single result
export function queryOne(db, sql, params = []) {
    const results = queryAll(db, sql, params);
    return results[0];
}
// Helper function to run a statement (INSERT, UPDATE, DELETE)
export function run(db, sql, params = []) {
    db.run(sql, params);
}
//# sourceMappingURL=client.js.map