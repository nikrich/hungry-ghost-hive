import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

// Re-export TeamRow for convenience
export type { TeamRow } from '../client.js';
import type { TeamRow } from '../client.js';

export interface CreateTeamInput {
  repoUrl: string;
  repoPath: string;
  name: string;
}

export function createTeam(db: Database.Database, input: CreateTeamInput): TeamRow {
  const id = `team-${nanoid(10)}`;
  const stmt = db.prepare(`
    INSERT INTO teams (id, repo_url, repo_path, name)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, input.repoUrl, input.repoPath, input.name);
  return getTeamById(db, id)!;
}

export function getTeamById(db: Database.Database, id: string): TeamRow | undefined {
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as TeamRow | undefined;
}

export function getTeamByName(db: Database.Database, name: string): TeamRow | undefined {
  return db.prepare('SELECT * FROM teams WHERE name = ?').get(name) as TeamRow | undefined;
}

export function getAllTeams(db: Database.Database): TeamRow[] {
  return db.prepare('SELECT * FROM teams ORDER BY created_at').all() as TeamRow[];
}

export function deleteTeam(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM teams WHERE id = ?').run(id);
}
