import type Database from 'better-sqlite3';
export type { AgentLogRow } from '../client.js';
import type { AgentLogRow } from '../client.js';
export type EventType = 'AGENT_SPAWNED' | 'AGENT_TERMINATED' | 'AGENT_RESUMED' | 'AGENT_CHECKPOINT' | 'REQUIREMENT_RECEIVED' | 'PLANNING_STARTED' | 'PLANNING_COMPLETED' | 'STORY_CREATED' | 'STORY_ESTIMATED' | 'STORY_ASSIGNED' | 'STORY_STARTED' | 'STORY_PROGRESS_UPDATE' | 'STORY_COMPLETED' | 'STORY_REVIEW_REQUESTED' | 'STORY_QA_STARTED' | 'STORY_QA_PASSED' | 'STORY_QA_FAILED' | 'STORY_PR_CREATED' | 'STORY_MERGED' | 'CODEBASE_SWEEP_STARTED' | 'CODEBASE_SWEEP_COMPLETED' | 'BUILD_STARTED' | 'BUILD_PASSED' | 'BUILD_FAILED' | 'CODE_QUALITY_CHECK_STARTED' | 'CODE_QUALITY_CHECK_PASSED' | 'CODE_QUALITY_CHECK_FAILED' | 'ESCALATION_CREATED' | 'ESCALATION_RESOLVED' | 'TEAM_SCALED_UP' | 'TEAM_SCALED_DOWN';
export interface CreateLogInput {
    agentId: string;
    storyId?: string | null;
    eventType: EventType;
    status?: string | null;
    message?: string | null;
    metadata?: Record<string, unknown> | null;
}
export declare function createLog(db: Database.Database, input: CreateLogInput): AgentLogRow;
export declare function getLogById(db: Database.Database, id: number): AgentLogRow | undefined;
export declare function getLogsByAgent(db: Database.Database, agentId: string, limit?: number): AgentLogRow[];
export declare function getLogsByStory(db: Database.Database, storyId: string): AgentLogRow[];
export declare function getLogsByEventType(db: Database.Database, eventType: EventType, limit?: number): AgentLogRow[];
export declare function getRecentLogs(db: Database.Database, limit?: number): AgentLogRow[];
export declare function getLogsSince(db: Database.Database, since: string): AgentLogRow[];
export declare function pruneOldLogs(db: Database.Database, retentionDays: number): number;
//# sourceMappingURL=logs.d.ts.map