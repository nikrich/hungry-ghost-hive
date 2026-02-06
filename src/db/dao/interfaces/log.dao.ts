import type { AgentLogRow, CreateLogInput, EventType } from '../../queries/logs.js';

export type { AgentLogRow, CreateLogInput, EventType };

export interface LogDao {
  createLog(input: CreateLogInput): Promise<AgentLogRow>;
  getLogById(id: number): Promise<AgentLogRow | undefined>;
  getLogsByAgent(agentId: string, limit?: number): Promise<AgentLogRow[]>;
  getLogsByStory(storyId: string): Promise<AgentLogRow[]>;
  getLogsByEventType(eventType: EventType, limit?: number): Promise<AgentLogRow[]>;
  getRecentLogs(limit?: number): Promise<AgentLogRow[]>;
  getLogsSince(since: string): Promise<AgentLogRow[]>;
  pruneOldLogs(retentionDays: number): Promise<number>;
}
