import type { TeamRow } from '../../queries/teams.js';
import type { CreateTeamInput } from '../../queries/teams.js';

export type { TeamRow, CreateTeamInput };

export interface TeamDao {
  createTeam(input: CreateTeamInput): Promise<TeamRow>;
  getTeamById(id: string): Promise<TeamRow | undefined>;
  getTeamByName(name: string): Promise<TeamRow | undefined>;
  getAllTeams(): Promise<TeamRow[]>;
  deleteTeam(id: string): Promise<void>;
}
