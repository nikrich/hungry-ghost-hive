-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 006: Add comprehensive Jira integration fields
-- Tracks Jira issues, subtasks, epics, and integration sync state

-- Stories table: Jira issue tracking
ALTER TABLE stories ADD COLUMN jira_issue_key TEXT;
ALTER TABLE stories ADD COLUMN jira_issue_id TEXT;
ALTER TABLE stories ADD COLUMN jira_project_key TEXT;
ALTER TABLE stories ADD COLUMN jira_subtask_key TEXT;
ALTER TABLE stories ADD COLUMN jira_subtask_id TEXT;

-- Requirements table: Jira epic tracking
ALTER TABLE requirements ADD COLUMN jira_epic_key TEXT;
ALTER TABLE requirements ADD COLUMN jira_epic_id TEXT;

-- Pull requests table: Jira issue link for PR tracking
ALTER TABLE pull_requests ADD COLUMN jira_issue_key TEXT;

-- Integration sync table: Track sync state for bidirectional updates
CREATE TABLE IF NOT EXISTS integration_sync (
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
);

-- Indexes for efficient sync lookups
CREATE INDEX IF NOT EXISTS idx_integration_sync_entity ON integration_sync(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_integration_sync_provider ON integration_sync(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_integration_sync_status ON integration_sync(sync_status);
CREATE INDEX IF NOT EXISTS idx_integration_sync_last_synced ON integration_sync(last_synced_at);
