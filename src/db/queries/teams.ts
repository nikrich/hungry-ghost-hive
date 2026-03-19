// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import { type TeamRow } from '../client.js';
import type { DatabaseProvider } from '../provider.js';

export type { TeamRow };

export interface CreateTeamInput {
  repoUrl: string;
  repoPath: string;
  name: string;
}

export async function createTeam(
  provider: DatabaseProvider,
  input: CreateTeamInput
): Promise<TeamRow> {
  const id = `team-${nanoid(10)}`;
  const now = new Date().toISOString();

  await provider.run(
    `
    INSERT INTO teams (id, repo_url, repo_path, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    [id, input.repoUrl, input.repoPath, input.name, now]
  );

  return (await getTeamById(provider, id))!;
}

export async function getTeamById(
  provider: DatabaseProvider,
  id: string
): Promise<TeamRow | undefined> {
  return await provider.queryOne<TeamRow>('SELECT * FROM teams WHERE id = ?', [id]);
}

export async function getTeamByName(
  provider: DatabaseProvider,
  name: string
): Promise<TeamRow | undefined> {
  return await provider.queryOne<TeamRow>('SELECT * FROM teams WHERE name = ?', [name]);
}

export async function getAllTeams(provider: DatabaseProvider): Promise<TeamRow[]> {
  return await provider.queryAll<TeamRow>('SELECT * FROM teams ORDER BY created_at');
}

export async function deleteTeam(provider: DatabaseProvider, id: string): Promise<void> {
  await provider.run('DELETE FROM teams WHERE id = ?', [id]);
}
