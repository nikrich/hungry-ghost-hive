import { nanoid } from 'nanoid';
import type { TeamDao } from '../interfaces/team.dao.js';
import type { TeamRow, CreateTeamInput } from '../../queries/teams.js';
import { LevelDbStore, type NowProvider, defaultNow } from './leveldb-store.js';
import { compareIsoAsc } from './sort.js';

const TEAM_PREFIX = 'team:';

export class LevelDbTeamDao implements TeamDao {
  private readonly now: NowProvider;

  constructor(private readonly store: LevelDbStore, now: NowProvider = defaultNow) {
    this.now = now;
  }

  async createTeam(input: CreateTeamInput): Promise<TeamRow> {
    const id = `team-${nanoid(10)}`;
    const now = this.now();

    const team: TeamRow = {
      id,
      repo_url: input.repoUrl,
      repo_path: input.repoPath,
      name: input.name,
      created_at: now,
    };

    await this.store.put(`${TEAM_PREFIX}${id}`, team);
    return team;
  }

  async getTeamById(id: string): Promise<TeamRow | undefined> {
    return this.store.get<TeamRow>(`${TEAM_PREFIX}${id}`);
  }

  async getTeamByName(name: string): Promise<TeamRow | undefined> {
    const teams = await this.store.listValues<TeamRow>(TEAM_PREFIX);
    const matches = teams.filter(team => team.name === name);
    if (matches.length === 0) return undefined;
    matches.sort(compareIsoAsc);
    return matches[0];
  }

  async getAllTeams(): Promise<TeamRow[]> {
    const teams = await this.store.listValues<TeamRow>(TEAM_PREFIX);
    return teams.sort(compareIsoAsc);
  }

  async deleteTeam(id: string): Promise<void> {
    await this.store.del(`${TEAM_PREFIX}${id}`);
  }
}
