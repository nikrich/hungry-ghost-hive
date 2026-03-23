-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 017: Add priority column to messages table for btw (non-interrupting) nudges

ALTER TABLE messages ADD COLUMN priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'low'));
