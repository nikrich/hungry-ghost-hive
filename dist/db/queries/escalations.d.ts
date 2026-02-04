import type { Database } from 'sql.js';
import { type EscalationRow } from '../client.js';
export type { EscalationRow };
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
export declare function createEscalation(db: Database, input: CreateEscalationInput): EscalationRow;
export declare function getEscalationById(db: Database, id: string): EscalationRow | undefined;
export declare function getEscalationsByStory(db: Database, storyId: string): EscalationRow[];
export declare function getEscalationsByFromAgent(db: Database, agentId: string): EscalationRow[];
export declare function getEscalationsByToAgent(db: Database, agentId: string | null): EscalationRow[];
export declare function getEscalationsByStatus(db: Database, status: EscalationStatus): EscalationRow[];
export declare function getPendingEscalations(db: Database): EscalationRow[];
export declare function getPendingHumanEscalations(db: Database): EscalationRow[];
export declare function getAllEscalations(db: Database): EscalationRow[];
export declare function updateEscalation(db: Database, id: string, input: UpdateEscalationInput): EscalationRow | undefined;
export declare function resolveEscalation(db: Database, id: string, resolution: string): EscalationRow | undefined;
export declare function acknowledgeEscalation(db: Database, id: string): EscalationRow | undefined;
export declare function deleteEscalation(db: Database, id: string): void;
//# sourceMappingURL=escalations.d.ts.map