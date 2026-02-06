import type { Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteTeamDao } from '../sqlite/team.sqlite-dao.js';
import { createTestDb } from './helpers.js';

describe('SqliteTeamDao', () => {
  let db: Database;
  let dao: SqliteTeamDao;

  beforeEach(async () => {
    db = await createTestDb();
    dao = new SqliteTeamDao(db);
  });

  afterEach(() => {
    db.close();
  });

  it('team.sqlite-dao case 1', async () => {
    const team = await dao.createTeam({
      repoUrl: 'https://github.com/test/repo',
      repoPath: '/tmp/repo',
      name: 'Test Team',
    });

    expect(team.id).toMatch(/^team-/);
    expect(team.repo_url).toBe('https://github.com/test/repo');
    expect(team.repo_path).toBe('/tmp/repo');
    expect(team.name).toBe('Test Team');
    expect(team.created_at).toBeDefined();
  });

  it('team.sqlite-dao case 2', async () => {
    const created = await dao.createTeam({
      repoUrl: 'https://github.com/test/repo',
      repoPath: '/tmp/repo',
      name: 'Test Team',
    });

    const found = await dao.getTeamById(created.id);
    expect(found).toEqual(created);
  });

  it('team.sqlite-dao case 3', async () => {
    const found = await dao.getTeamById('team-nonexistent');
    expect(found).toBeUndefined();
  });

  it('team.sqlite-dao case 4', async () => {
    const created = await dao.createTeam({
      repoUrl: 'https://github.com/test/repo',
      repoPath: '/tmp/repo',
      name: 'Alpha Team',
    });

    const found = await dao.getTeamByName('Alpha Team');
    expect(found).toEqual(created);
  });

  it('team.sqlite-dao case 5', async () => {
    const found = await dao.getTeamByName('Nonexistent');
    expect(found).toBeUndefined();
  });

  it('team.sqlite-dao case 6', async () => {
    const team1 = await dao.createTeam({ repoUrl: 'url1', repoPath: '/p1', name: 'Team A' });
    const team2 = await dao.createTeam({ repoUrl: 'url2', repoPath: '/p2', name: 'Team B' });
    const team3 = await dao.createTeam({ repoUrl: 'url3', repoPath: '/p3', name: 'Team C' });

    const all = await dao.getAllTeams();
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe(team1.id);
    expect(all[1].id).toBe(team2.id);
    expect(all[2].id).toBe(team3.id);
  });

  it('team.sqlite-dao case 7', async () => {
    const all = await dao.getAllTeams();
    expect(all).toEqual([]);
  });

  it('team.sqlite-dao case 8', async () => {
    const team = await dao.createTeam({ repoUrl: 'url', repoPath: '/p', name: 'Delete Me' });
    await dao.deleteTeam(team.id);

    const found = await dao.getTeamById(team.id);
    expect(found).toBeUndefined();
  });
});
