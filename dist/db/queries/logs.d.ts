import type { Database } from 'sql.js';
import { type AgentLogRow } from '../client.js';
export type { AgentLogRow };
export type EventType = 'AGENT_SPAWNED' | 'AGENT_TERMINATED' | 'AGENT_RESUMED' | 'AGENT_CHECKPOINT' | 'REQUIREMENT_RECEIVED' | 'PLANNING_STARTED' | 'PLANNING_COMPLETED' | 'STORY_CREATED' | 'STORY_ESTIMATED' | 'STORY_ASSIGNED' | 'STORY_STARTED' | 'STORY_PROGRESS_UPDATE' | 'STORY_COMPLETED' | 'STORY_REVIEW_REQUESTED' | 'STORY_QA_STARTED' | 'STORY_QA_PASSED' | 'STORY_QA_FAILED' | 'STORY_PR_CREATED' | 'STORY_MERGED' | 'DUPLICATE_ASSIGNMENT_PREVENTED' | 'CODEBASE_SWEEP_STARTED' | 'CODEBASE_SWEEP_COMPLETED' | 'BUILD_STARTED' | 'BUILD_PASSED' | 'BUILD_FAILED' | 'CODE_QUALITY_CHECK_STARTED' | 'CODE_QUALITY_CHECK_PASSED' | 'CODE_QUALITY_CHECK_FAILED' | 'ESCALATION_CREATED' | 'ESCALATION_RESOLVED' | 'TEAM_SCALED_UP' | 'TEAM_SCALED_DOWN' | 'QA_SPAWNED' | 'PR_SUBMITTED' | 'PR_REVIEW_STARTED' | 'PR_APPROVED' | 'PR_MERGED' | 'PR_REJECTED' | 'PR_MERGE_FAILED';
export interface CreateLogInput {
    agentId: string;
    storyId?: string | null;
    eventType: EventType;
    status?: string | null;
    message?: string | null;
    metadata?: Record<string, unknown> | null;
}
export declare function createLog(db: Database, input: CreateLogInput): AgentLogRow;
export declare function getLogById(db: Database, id: number): AgentLogRow | undefined;
export declare function getLogsByAgent(db: Database, agentId: string, limit?: number): AgentLogRow[];
export declare function getLogsByStory(db: Database, storyId: string): AgentLogRow[];
export declare function getLogsByEventType(db: Database, eventType: EventType, limit?: number): AgentLogRow[];
export declare function getRecentLogs(db: Database, limit?: number): AgentLogRow[];
export declare function getLogsSince(db: Database, since: string): AgentLogRow[];
export declare function pruneOldLogs(db: Database, retentionDays: number): number;
//# sourceMappingURL=logs.d.ts.map