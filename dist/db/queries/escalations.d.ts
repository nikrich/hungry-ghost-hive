import type Database from 'better-sqlite3';
export type { EscalationRow } from '../client.js';
import type { EscalationRow } from '../client.js';
export type EscalationStatus = 'pending' | 'acknowledged' | 'resolved';
export interface CreateEscalationInput {
    storyId?: string | null;
    fromAgentId?: string | null;
    toAgentId?: string | null;
    reason: string;
}
export interface UpdateEscalationInput {
    status?: EscalationStatus;
    toAgentId?: string | null;
    resolution?: string | null;
}
export declare function createEscalation(db: Database.Database, input: CreateEscalationInput): EscalationRow;
export declare function getEscalationById(db: Database.Database, id: string): EscalationRow | undefined;
export declare function getEscalationsByStory(db: Database.Database, storyId: string): EscalationRow[];
export declare function getEscalationsByFromAgent(db: Database.Database, agentId: string): EscalationRow[];
export declare function getEscalationsByToAgent(db: Database.Database, agentId: string | null): EscalationRow[];
export declare function getEscalationsByStatus(db: Database.Database, status: EscalationStatus): EscalationRow[];
export declare function getPendingEscalations(db: Database.Database): EscalationRow[];
export declare function getPendingHumanEscalations(db: Database.Database): EscalationRow[];
export declare function getAllEscalations(db: Database.Database): EscalationRow[];
export declare function updateEscalation(db: Database.Database, id: string, input: UpdateEscalationInput): EscalationRow | undefined;
export declare function resolveEscalation(db: Database.Database, id: string, resolution: string): EscalationRow | undefined;
export declare function acknowledgeEscalation(db: Database.Database, id: string): EscalationRow | undefined;
export declare function deleteEscalation(db: Database.Database, id: string): void;
//# sourceMappingURL=escalations.d.ts.map