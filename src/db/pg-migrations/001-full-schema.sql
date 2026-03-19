-- Licensed under the Hungry Ghost Hive License. See LICENSE.
-- Postgres full schema for distributed hive mode.
-- Equivalent to all 15 SQLite migrations combined.
-- Every table includes workspace_id for multi-tenant isolation.

-- Migrations tracking (no workspace_id — shared across all workspaces)
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa', 'feature_test', 'auditor')),
    team_id TEXT,
    tmux_session TEXT,
    model TEXT,
    status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
    current_story_id TEXT,
    memory_state TEXT,
    last_seen TIMESTAMPTZ,
    worktree_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Requirements
CREATE TABLE IF NOT EXISTS requirements (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    submitted_by TEXT DEFAULT 'human',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed', 'sign_off', 'sign_off_failed', 'sign_off_passed')),
    godmode BOOLEAN DEFAULT FALSE,
    target_branch TEXT DEFAULT 'main',
    feature_branch TEXT,
    jira_epic_key TEXT,
    jira_epic_id TEXT,
    external_epic_key TEXT,
    external_epic_id TEXT,
    external_provider TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Stories
CREATE TABLE IF NOT EXISTS stories (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    requirement_id TEXT,
    team_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acceptance_criteria TEXT,
    complexity_score INTEGER CHECK (complexity_score BETWEEN 1 AND 13),
    story_points INTEGER,
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft', 'estimated', 'planned', 'in_progress',
        'review', 'qa', 'qa_failed', 'pr_submitted', 'merged'
    )),
    assigned_agent_id TEXT,
    branch_name TEXT,
    pr_url TEXT,
    jira_issue_key TEXT,
    jira_issue_id TEXT,
    jira_project_key TEXT,
    jira_subtask_key TEXT,
    jira_subtask_id TEXT,
    external_issue_key TEXT,
    external_issue_id TEXT,
    external_project_key TEXT,
    external_subtask_key TEXT,
    external_subtask_id TEXT,
    external_provider TEXT,
    in_sprint INTEGER DEFAULT 0,
    markdown_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Story Dependencies
CREATE TABLE IF NOT EXISTS story_dependencies (
    workspace_id TEXT NOT NULL,
    story_id TEXT NOT NULL,
    depends_on_story_id TEXT NOT NULL,
    PRIMARY KEY (story_id, depends_on_story_id, workspace_id)
);

-- Agent Logs (event sourcing - immutable append-only log)
CREATE TABLE IF NOT EXISTS agent_logs (
    id SERIAL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    story_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT,
    message TEXT,
    metadata TEXT,
    "timestamp" TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Escalations
CREATE TABLE IF NOT EXISTS escalations (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    story_id TEXT,
    from_agent_id TEXT,
    to_agent_id TEXT,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    PRIMARY KEY (id, workspace_id)
);

-- Pull Requests
CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    story_id TEXT,
    team_id TEXT,
    branch_name TEXT NOT NULL DEFAULT '',
    github_pr_number INTEGER,
    github_pr_url TEXT,
    submitted_by TEXT,
    reviewed_by TEXT,
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'reviewing', 'approved', 'merged', 'rejected', 'closed')),
    review_notes TEXT,
    jira_issue_key TEXT,
    external_issue_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    PRIMARY KEY (id, workspace_id)
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    from_session TEXT NOT NULL,
    to_session TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    reply TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'replied')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    replied_at TIMESTAMPTZ,
    PRIMARY KEY (id, workspace_id)
);

-- Integration Sync
CREATE TABLE IF NOT EXISTS integration_sync (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('story', 'requirement', 'pull_request')),
    entity_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('jira', 'github', 'confluence')),
    external_id TEXT NOT NULL,
    last_synced_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Token Usage
CREATE TABLE IF NOT EXISTS token_usage (
    id SERIAL,
    workspace_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    story_id TEXT,
    requirement_id TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    session_id TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, workspace_id)
);

-- Indexes (all scoped to workspace_id for query performance)
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_story ON agent_logs(workspace_id, story_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(workspace_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_stories_team_id ON stories(workspace_id, team_id);
CREATE INDEX IF NOT EXISTS idx_stories_assigned_agent_id ON stories(workspace_id, assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_stories_requirement_id ON stories(workspace_id, requirement_id);
CREATE INDEX IF NOT EXISTS idx_stories_external_issue_key ON stories(workspace_id, external_issue_key);
CREATE INDEX IF NOT EXISTS idx_stories_external_provider ON stories(workspace_id, external_provider);
CREATE INDEX IF NOT EXISTS idx_agents_team_id ON agents(workspace_id, team_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_team_status ON pull_requests(workspace_id, team_id, status);
CREATE INDEX IF NOT EXISTS idx_pull_requests_story_id ON pull_requests(workspace_id, story_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_status_branch ON pull_requests(workspace_id, status, branch_name);
CREATE INDEX IF NOT EXISTS idx_pull_requests_github_pr_number ON pull_requests(workspace_id, github_pr_number);
CREATE INDEX IF NOT EXISTS idx_messages_to_session ON messages(workspace_id, to_session);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_integration_sync_entity ON integration_sync(workspace_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_integration_sync_provider ON integration_sync(workspace_id, provider, external_id);
CREATE INDEX IF NOT EXISTS idx_integration_sync_status ON integration_sync(workspace_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_integration_sync_last_synced ON integration_sync(workspace_id, last_synced_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_sync_unique ON integration_sync(workspace_id, entity_type, entity_id, provider);
CREATE INDEX IF NOT EXISTS idx_token_usage_agent_id ON token_usage(workspace_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_story_id ON token_usage(workspace_id, story_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_requirement_id ON token_usage(workspace_id, requirement_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(workspace_id, session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_recorded_at ON token_usage(workspace_id, recorded_at);
