-- Migration 006: Add missing database indexes for query performance
-- Adds indexes on frequently-queried columns to avoid full table scans

-- Stories indexes
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_team_id ON stories(team_id);
CREATE INDEX IF NOT EXISTS idx_stories_assigned_agent_id ON stories(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_stories_team_status ON stories(team_id, status);

-- Agents indexes
CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(team_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_team_status ON agents(team_id, status);

-- Pull Requests indexes
CREATE INDEX IF NOT EXISTS idx_pull_requests_status ON pull_requests(status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_team_id ON pull_requests(team_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_story_id ON pull_requests(story_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_team_status ON pull_requests(team_id, status);

-- Escalations indexes
CREATE INDEX IF NOT EXISTS idx_escalations_story_id ON escalations(story_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_from_agent ON escalations(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_escalations_to_agent ON escalations(to_agent_id);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_to_session ON messages(to_session);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- Story Dependencies indexes
CREATE INDEX IF NOT EXISTS idx_story_dependencies_depends_on ON story_dependencies(depends_on_story_id);

-- Heartbeat optimization
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen);
