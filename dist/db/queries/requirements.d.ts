import type Database from 'better-sqlite3';
export type { RequirementRow } from '../client.js';
import type { RequirementRow } from '../client.js';
export type RequirementStatus = 'pending' | 'planning' | 'planned' | 'in_progress' | 'completed';
export interface CreateRequirementInput {
    title: string;
    description: string;
    submittedBy?: string;
}
export interface UpdateRequirementInput {
    title?: string;
    description?: string;
    status?: RequirementStatus;
}
export declare function createRequirement(db: Database.Database, input: CreateRequirementInput): RequirementRow;
export declare function getRequirementById(db: Database.Database, id: string): RequirementRow | undefined;
export declare function getAllRequirements(db: Database.Database): RequirementRow[];
export declare function getRequirementsByStatus(db: Database.Database, status: RequirementStatus): RequirementRow[];
export declare function getPendingRequirements(db: Database.Database): RequirementRow[];
export declare function updateRequirement(db: Database.Database, id: string, input: UpdateRequirementInput): RequirementRow | undefined;
export declare function deleteRequirement(db: Database.Database, id: string): void;
//# sourceMappingURL=requirements.d.ts.map