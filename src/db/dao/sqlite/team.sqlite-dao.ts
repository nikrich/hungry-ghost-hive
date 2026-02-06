import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../../client.js';
import type { CreateTeamInput, TeamRow } from '../../queries/teams.js';
import type { TeamDao } from '../interfaces/team.dao.js';

export class SqliteTeamDao implements TeamDao {
  constructor(private readonly db: Database) {}

  async createTeam(input: CreateTeamInput): Promise<TeamRow> {
    const id = `team-${nanoid(10)}`;
    const now = new Date().toISOString();

    run(
      this.db,
      `
      INSERT INTO teams (id, repo_url, repo_path, name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      [id, input.repoUrl, input.repoPath, input.name, now]
    );

    return (await this.getTeamById(id))!;
  }

  async getTeamById(id: string): Promise<TeamRow | undefined> {
    return queryOne<TeamRow>(this.db, 'SELECT * FROM teams WHERE id = ?', [id]);
  }

  async getTeamByName(name: string): Promise<TeamRow | undefined> {
    return queryOne<TeamRow>(this.db, 'SELECT * FROM teams WHERE name = ?', [name]);
  }

  async getAllTeams(): Promise<TeamRow[]> {
    return queryAll<TeamRow>(this.db, 'SELECT * FROM teams ORDER BY created_at');
  }

  async deleteTeam(id: string): Promise<void> {
    run(this.db, 'DELETE FROM teams WHERE id = ?', [id]);
  }
}
