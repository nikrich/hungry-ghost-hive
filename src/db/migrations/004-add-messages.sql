-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 004: Add messages table for inter-agent communication

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_session TEXT NOT NULL,
  to_session TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  reply TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'replied')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  replied_at TIMESTAMP
);
