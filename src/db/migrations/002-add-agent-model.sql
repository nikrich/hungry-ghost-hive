-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 002: Add model column to agents table

ALTER TABLE agents ADD COLUMN model TEXT;
