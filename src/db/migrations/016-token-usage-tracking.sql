-- Migration 016: Add token_usage table for tracking token consumption per agent session.
-- Tracks input/output/total tokens, model, and session metadata.

CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    story_id TEXT REFERENCES stories(id),
    requirement_id TEXT REFERENCES requirements(id),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    session_id TEXT,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_token_usage_agent_id ON token_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_story_id ON token_usage(story_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_requirement_id ON token_usage(requirement_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_recorded_at ON token_usage(recorded_at);
