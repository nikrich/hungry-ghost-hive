import type { CreateTeamInput, TeamRow } from '../../queries/teams.js';

export type { CreateTeamInput, TeamRow };

export interface TeamDao {
  createTeam(input: CreateTeamInput): Promise<TeamRow>;
  getTeamById(id: string): Promise<TeamRow | undefined>;
  getTeamByName(name: string): Promise<TeamRow | undefined>;
  getAllTeams(): Promise<TeamRow[]>;
  deleteTeam(id: string): Promise<void>;
}
