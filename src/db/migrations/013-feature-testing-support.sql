-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 013: Add feature testing support
-- Adds feature_branch column to requirements table

ALTER TABLE requirements ADD COLUMN feature_branch TEXT;
