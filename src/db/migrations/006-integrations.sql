-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 006: Add Jira integration fields to stories table
-- Tracks which Jira issues correspond to stories for bidirectional sync

ALTER TABLE stories ADD COLUMN jira_issue_key TEXT;
ALTER TABLE stories ADD COLUMN jira_issue_id TEXT;
ALTER TABLE stories ADD COLUMN jira_project_key TEXT;
