import type Database from 'better-sqlite3';
export type { AgentRow } from '../client.js';
import type { AgentRow } from '../client.js';
export type AgentType = 'tech_lead' | 'senior' | 'intermediate' | 'junior' | 'qa';
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'terminated';
export interface CreateAgentInput {
    type: AgentType;
    teamId?: string | null;
    tmuxSession?: string | null;
}
export interface UpdateAgentInput {
    status?: AgentStatus;
    tmuxSession?: string | null;
    currentStoryId?: string | null;
    memoryState?: string | null;
}
export declare function createAgent(db: Database.Database, input: CreateAgentInput): AgentRow;
export declare function getAgentById(db: Database.Database, id: string): AgentRow | undefined;
export declare function getAgentsByTeam(db: Database.Database, teamId: string): AgentRow[];
export declare function getAgentsByType(db: Database.Database, type: AgentType): AgentRow[];
export declare function getAgentsByStatus(db: Database.Database, status: AgentStatus): AgentRow[];
export declare function getAllAgents(db: Database.Database): AgentRow[];
export declare function getActiveAgents(db: Database.Database): AgentRow[];
export declare function getTechLead(db: Database.Database): AgentRow | undefined;
export declare function updateAgent(db: Database.Database, id: string, input: UpdateAgentInput): AgentRow | undefined;
export declare function deleteAgent(db: Database.Database, id: string): void;
export declare function terminateAgent(db: Database.Database, id: string): void;
//# sourceMappingURL=agents.d.ts.map