// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { createTeam, getTeamByName } from '../../db/queries/teams.js';

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

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    text: '',
    start() {
      return this;
    },
    fail() {
      return this;
    },
    succeed() {
      return this;
    },
  })),
}));

import { addRepoCommand } from './add-repo.js';

describe('add-repo command', () => {
  const resetCommandOptions = (command: Command): void => {
    for (const option of command.options) {
      command.setOptionValue(option.attributeName(), undefined);
    }
  };

  const run = async (...args: string[]): Promise<void> => {
    await addRepoCommand.parseAsync(args, { from: 'user' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(addRepoCommand);
    process.exitCode = undefined;
    vi.mocked(getTeamByName).mockReturnValue(undefined);
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

  it('sets exitCode instead of calling process.exit when team already exists', async () => {
    vi.mocked(getTeamByName).mockReturnValue({
      id: 'team-existing',
      name: 'test-team',
    } as ReturnType<typeof getTeamByName>);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as typeof process.exit);

    await run('--url', 'https://github.com/test/repo.git', '--team', 'test-team');

    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(execa).not.toHaveBeenCalled();
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('sets exitCode instead of calling process.exit on unexpected failure', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('git failed'));
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as typeof process.exit);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await run('--url', 'https://github.com/test/repo.git', '--team', 'test-team');

    expect(process.exitCode).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
