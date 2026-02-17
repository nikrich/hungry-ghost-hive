// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';
// @ts-ignore Database.Database type;
import { queryAll, queryOne, run, type TeamRow } from '../client.js';

export type { TeamRow };

export interface CreateTeamInput {
  repoUrl: string;
  repoPath: string;
  name: string;
}

export function createTeam(db: Database.Database, input: CreateTeamInput): TeamRow {
  const id = `team-${nanoid(10)}`;
  const now = new Date().toISOString();

  run(
    db,
    `
    INSERT INTO teams (id, repo_url, repo_path, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    [id, input.repoUrl, input.repoPath, input.name, now]
  );

  return getTeamById(db, id)!;
}

export function getTeamById(db: Database.Database, id: string): TeamRow | undefined {
  return queryOne<TeamRow>(db, 'SELECT * FROM teams WHERE id = ?', [id]);
}

export function getTeamByName(db: Database.Database, name: string): TeamRow | undefined {
  return queryOne<TeamRow>(db, 'SELECT * FROM teams WHERE name = ?', [name]);
}

export function getAllTeams(db: Database.Database): TeamRow[] {
  return queryAll<TeamRow>(db, 'SELECT * FROM teams ORDER BY created_at');
}

export function deleteTeam(db: Database.Database, id: string): void {
  run(db, 'DELETE FROM teams WHERE id = ?', [id]);
}
