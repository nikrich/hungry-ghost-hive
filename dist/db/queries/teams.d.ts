import type Database from 'better-sqlite3';
export type { TeamRow } from '../client.js';
import type { TeamRow } from '../client.js';
export interface CreateTeamInput {
    repoUrl: string;
    repoPath: string;
    name: string;
}
export declare function createTeam(db: Database.Database, input: CreateTeamInput): TeamRow;
export declare function getTeamById(db: Database.Database, id: string): TeamRow | undefined;
export declare function getTeamByName(db: Database.Database, name: string): TeamRow | undefined;
export declare function getAllTeams(db: Database.Database): TeamRow[];
export declare function deleteTeam(db: Database.Database, id: string): void;
//# sourceMappingURL=teams.d.ts.map