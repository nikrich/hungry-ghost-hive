-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 012: Add in_sprint column and unique constraint on integration_sync

-- Add in_sprint column to stories table
ALTER TABLE stories ADD COLUMN in_sprint INTEGER DEFAULT 0;

-- Add unique index on integration_sync to prevent duplicate sync records
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_sync_unique ON integration_sync(entity_type, entity_id, provider);
