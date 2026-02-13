-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 003: Fix pull_requests table schema for merge queue

-- SQLite doesn't support ALTER COLUMN or ADD CONSTRAINT, so we need to recreate the table
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
);

-- Copy existing data (map old statuses to new ones)
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
FROM pull_requests;

-- Drop old table and rename new one
DROP TABLE pull_requests;
ALTER TABLE pull_requests_new RENAME TO pull_requests;
