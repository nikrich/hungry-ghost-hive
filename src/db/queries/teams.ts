// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { TeamRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { TeamRow };

export interface CreateTeamInput {
  repoUrl: string;
  repoPath: string;
  name: string;
}

export function createTeam(provider: DatabaseProvider, input: CreateTeamInput): TeamRow {
  const id = `team-${nanoid(10)}`;
  const now = new Date().toISOString();

  provider.run(
    `
    INSERT INTO teams (id, repo_url, repo_path, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    [id, input.repoUrl, input.repoPath, input.name, now]
  );

  return getTeamById(provider, id)!;
}

export function getTeamById(provider: DatabaseProvider, id: string): TeamRow | undefined {
  return provider.queryOne<TeamRow>('SELECT * FROM teams WHERE id = ?', [id]);
}

export function getTeamByName(provider: DatabaseProvider, name: string): TeamRow | undefined {
  return provider.queryOne<TeamRow>('SELECT * FROM teams WHERE name = ?', [name]);
}

export function getAllTeams(provider: DatabaseProvider): TeamRow[] {
  return provider.queryAll<TeamRow>('SELECT * FROM teams ORDER BY created_at');
}

export function deleteTeam(provider: DatabaseProvider, id: string): void {
  provider.run('DELETE FROM teams WHERE id = ?', [id]);
}
