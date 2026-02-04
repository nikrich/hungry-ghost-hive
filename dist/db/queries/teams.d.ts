import type { Database } from 'sql.js';
import { type TeamRow } from '../client.js';
export type { TeamRow };
export interface CreateTeamInput {
    repoUrl: string;
    repoPath: string;
    name: string;
}
export declare function createTeam(db: Database, input: CreateTeamInput): TeamRow;
export declare function getTeamById(db: Database, id: string): TeamRow | undefined;
export declare function getTeamByName(db: Database, name: string): TeamRow | undefined;
export declare function getAllTeams(db: Database): TeamRow[];
export declare function deleteTeam(db: Database, id: string): void;
//# sourceMappingURL=teams.d.ts.map