import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTeam, deleteTeam, getAllTeams, getTeamById, getTeamByName } from './teams.js';
import { createTestDatabase } from './test-helpers.js';

describe('teams queries', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  describe('createTeam', () => {
    it('should create a team with all fields', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });

      expect(team.id).toMatch(/^team-/);
      expect(team.repo_url).toBe('https://github.com/test/repo.git');
      expect(team.repo_path).toBe('/path/to/repo');
      expect(team.name).toBe('Test Team');
      expect(team.created_at).toBeDefined();
    });

    it('should generate unique IDs for each team', () => {
      const team1 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo1.git',
        repoPath: '/path/to/repo1',
        name: 'Team 1',
      });

      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });

      expect(team1.id).not.toBe(team2.id);
    });
  });

  describe('getTeamById', () => {
    it('should retrieve a team by ID', () => {
      const created = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Test Team',
      });

      const retrieved = getTeamById(db, created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe('Test Team');
    });

    it('should return undefined for non-existent team', () => {
      const result = getTeamById(db, 'non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getTeamByName', () => {
    it('should retrieve a team by name', () => {
      createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Unique Team',
      });

      const retrieved = getTeamByName(db, 'Unique Team');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Unique Team');
    });

    it('should return undefined for non-existent team name', () => {
      const result = getTeamByName(db, 'Non Existent Team');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllTeams', () => {
    it('should return empty array when no teams exist', () => {
      const teams = getAllTeams(db);
      expect(teams).toEqual([]);
    });

    it('should return all teams ordered by created_at', () => {
      const team1 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo1.git',
        repoPath: '/path/to/repo1',
        name: 'Team 1',
      });

      const team2 = createTeam(db, {
        repoUrl: 'https://github.com/test/repo2.git',
        repoPath: '/path/to/repo2',
        name: 'Team 2',
      });

      const teams = getAllTeams(db);

      expect(teams).toHaveLength(2);
      expect(teams[0].id).toBe(team1.id);
      expect(teams[1].id).toBe(team2.id);
    });
  });

  describe('deleteTeam', () => {
    it('should delete a team', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Team to Delete',
      });

      deleteTeam(db, team.id);

      const retrieved = getTeamById(db, team.id);
      expect(retrieved).toBeUndefined();
    });

    it('should not throw when deleting non-existent team', () => {
      expect(() => deleteTeam(db, 'non-existent-id')).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in team name', () => {
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: 'Team with \'quotes\' and "double quotes"',
      });

      const retrieved = getTeamById(db, team.id);
      expect(retrieved?.name).toBe('Team with \'quotes\' and "double quotes"');
    });

    it('should handle very long team names', () => {
      const longName = 'A'.repeat(500);
      const team = createTeam(db, {
        repoUrl: 'https://github.com/test/repo.git',
        repoPath: '/path/to/repo',
        name: longName,
      });

      const retrieved = getTeamById(db, team.id);
      expect(retrieved?.name).toBe(longName);
    });
  });
});
