// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('../../db/queries/teams.js', () => ({
  createTeam: vi.fn(() => ({
    id: 'team-1',
    name: 'test-team',
    repo_url: 'https://github.com/test/repo.git',
    repo_path: 'repos/repo',
  })),
  getTeamByName: vi.fn(),
}));

vi.mock('../../utils/with-hive-context.js', () => ({
  withHiveContext: vi.fn(callback =>
    callback({ db: { db: {} }, root: '/tmp', paths: { reposDir: '/tmp/repos' } })
  ),
}));

import { addRepoCommand } from './add-repo.js';

describe('add-repo command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command structure', () => {
    it('should have add-repo command with correct name', () => {
      expect(addRepoCommand.name()).toBe('add-repo');
    });

    it('should have description', () => {
      expect(addRepoCommand.description()).toContain('repository');
    });

    it('should have required --url option', () => {
      const urlOpt = addRepoCommand.options.find(opt => opt.long === '--url');
      expect(urlOpt).toBeDefined();
      expect(urlOpt?.required).toBe(true);
    });

    it('should have required --team option', () => {
      const teamOpt = addRepoCommand.options.find(opt => opt.long === '--team');
      expect(teamOpt).toBeDefined();
      expect(teamOpt?.required).toBe(true);
    });

    it('should have --branch option', () => {
      const branchOpt = addRepoCommand.options.find(opt => opt.long === '--branch');
      expect(branchOpt).toBeDefined();
    });
  });
});
