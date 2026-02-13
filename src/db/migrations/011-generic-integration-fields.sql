-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 011: Add generic provider-agnostic integration fields

-- Add generic columns to stories table
ALTER TABLE stories ADD COLUMN external_issue_key TEXT;
ALTER TABLE stories ADD COLUMN external_issue_id TEXT;
ALTER TABLE stories ADD COLUMN external_project_key TEXT;
ALTER TABLE stories ADD COLUMN external_subtask_key TEXT;
ALTER TABLE stories ADD COLUMN external_subtask_id TEXT;
ALTER TABLE stories ADD COLUMN external_provider TEXT;

-- Add generic columns to requirements table
ALTER TABLE requirements ADD COLUMN external_epic_key TEXT;
ALTER TABLE requirements ADD COLUMN external_epic_id TEXT;
ALTER TABLE requirements ADD COLUMN external_provider TEXT;

-- Copy data from jira_* to external_* columns
UPDATE stories SET
  external_issue_key = jira_issue_key,
  external_issue_id = jira_issue_id,
  external_project_key = jira_project_key,
  external_subtask_key = jira_subtask_key,
  external_subtask_id = jira_subtask_id,
  external_provider = 'jira'
WHERE jira_issue_key IS NOT NULL OR jira_subtask_key IS NOT NULL;

UPDATE requirements SET
  external_epic_key = jira_epic_key,
  external_epic_id = jira_epic_id,
  external_provider = 'jira'
WHERE jira_epic_key IS NOT NULL;

-- Add indexes on new generic columns
CREATE INDEX IF NOT EXISTS idx_stories_external_issue_key ON stories(external_issue_key);
CREATE INDEX IF NOT EXISTS idx_stories_external_provider ON stories(external_provider);
