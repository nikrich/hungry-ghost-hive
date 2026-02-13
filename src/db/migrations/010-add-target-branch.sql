-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 010: Add target_branch column to requirements table

ALTER TABLE requirements ADD COLUMN target_branch TEXT DEFAULT 'main';
