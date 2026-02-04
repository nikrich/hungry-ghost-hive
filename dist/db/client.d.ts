import { Database as SqlJsDatabase } from 'sql.js';
export interface DatabaseClient {
    db: SqlJsDatabase;
    close: () => void;
    save: () => void;
    runMigrations: () => void;
}
export declare function createDatabase(dbPath: string): Promise<DatabaseClient>;
export declare function getDatabase(hiveDir: string): Promise<DatabaseClient>;
export declare function queryAll<T>(db: SqlJsDatabase, sql: string, params?: unknown[]): T[];
export declare function queryOne<T>(db: SqlJsDatabase, sql: string, params?: unknown[]): T | undefined;
export declare function run(db: SqlJsDatabase, sql: string, params?: unknown[]): void;
export interface TeamRow {
    id: string;
    repo_url: string;
    repo_path: string;
    name: string;
    created_at: string;
}
export interface AgentRow {
    id: string;
    type: 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa';
    team_id: string | null;
    tmux_session: string | null;
    status: 'idle' | 'working' | 'blocked' | 'terminated';
    current_story_id: string | null;
    memory_state: string | null;
    created_at: string;
    updated_at: string;
}
export interface RequirementRow {
    id: string;
    title: string;
    description: string;
    submitted_by: string;
    status: 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';
    created_at: string;
}
export interface StoryRow {
    id: string;
    requirement_id: string | null;
    team_id: string | null;
    title: string;
    description: string;
    acceptance_criteria: string | null;
    complexity_score: number | null;
    story_points: number | null;
    status: 'draft' | 'estimated' | 'planned' | 'in_progress' | 'review' | 'qa' | 'qa_failed' | 'pr_submitted' | 'merged';
    assigned_agent_id: string | null;
    branch_name: string | null;
    pr_url: string | null;
    created_at: string;
    updated_at: string;
}
export interface AgentLogRow {
    id: number;
    agent_id: string;
    story_id: string | null;
    event_type: string;
    status: string | null;
    message: string | null;
    metadata: string | null;
    timestamp: string;
}
export interface EscalationRow {
    id: string;
    story_id: string | null;
    from_agent_id: string | null;
    to_agent_id: string | null;
    reason: string;
    status: 'pending' | 'acknowledged' | 'resolved';
    resolution: string | null;
    created_at: string;
    resolved_at: string | null;
}
export interface PullRequestRow {
    id: string;
    story_id: string | null;
    github_pr_number: number | null;
    github_pr_url: string | null;
    status: 'open' | 'review' | 'approved' | 'merged' | 'closed';
    review_comments: string | null;
    created_at: string;
    updated_at: string;
}
//# sourceMappingURL=client.d.ts.map