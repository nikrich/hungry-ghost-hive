// Licensed under the Hungry Ghost Hive License. See LICENSE.

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

/**
 * Creates an in-memory database for testing
 * This is a shared helper for all query module tests
 */
export async function createTestDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Run initial schema
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa')),
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
    );

    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'human',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed')),
      godmode BOOLEAN DEFAULT 0,
      target_branch TEXT DEFAULT 'main',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

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
      jira_issue_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS story_dependencies (
      story_id TEXT REFERENCES stories(id),
      depends_on_story_id TEXT REFERENCES stories(id),
      PRIMARY KEY (story_id, depends_on_story_id)
    );

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
      jira_issue_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP
    );

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
  `);

  return db;
}
