-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 008: Add godmode column to requirements table

ALTER TABLE requirements ADD COLUMN godmode BOOLEAN DEFAULT 0;
