import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as branches from './branches.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa as mockExeca } from 'execa';

const mockedExeca = vi.mocked(mockExeca);

describe('branches module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentBranch', () => {
    const workDir = '/test/repo';

    it('should get current branch name', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'main\n',
        stderr: '',
      } as any);

      const result = await branches.getCurrentBranch(workDir);

      expect(result).toBe('main');
      expect(mockedExeca).toHaveBeenCalledWith('git', ['branch', '--show-current'], {
        cwd: workDir,
      });
    });

    it('should trim whitespace from branch name', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '  feature/test-branch  \n',
        stderr: '',
      } as any);

      const result = await branches.getCurrentBranch(workDir);

      expect(result).toBe('feature/test-branch');
    });

    it('should throw error if git command fails', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('Not a git repository'));

      await expect(branches.getCurrentBranch(workDir)).rejects.toThrow('Not a git repository');
    });
  });

  describe('listBranches', () => {
    const workDir = '/test/repo';

    it('should list all branches with their info', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: `main|abc1234|
feature/test|def5678|*
bugfix/urgent|ghi9012|`,
        stderr: '',
      } as any);

      const result = await branches.listBranches(workDir);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        name: 'main',
        current: false,
        lastCommit: 'abc1234',
      });
      expect(result[1]).toEqual({
        name: 'feature/test',
        current: true,
        lastCommit: 'def5678',
      });
      expect(result[2]).toEqual({
        name: 'bugfix/urgent',
        current: false,
        lastCommit: 'ghi9012',
      });
    });

    it('should handle empty branch list', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      const result = await branches.listBranches(workDir);

      expect(result).toHaveLength(0);
    });

    it('should filter empty lines', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: `main|abc1234|

feature/test|def5678|
`,
        stderr: '',
      } as any);

      const result = await branches.listBranches(workDir);

      expect(result).toHaveLength(2);
    });
  });

  describe('createBranch', () => {
    const workDir = '/test/repo';
    const branchName = 'feature/new-feature';

    it('should create a new branch without start point', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await branches.createBranch(workDir, branchName);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['branch', branchName], {
        cwd: workDir,
      });
    });

    it('should create a new branch with start point', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await branches.createBranch(workDir, branchName, 'main');

      expect(mockedExeca).toHaveBeenCalledWith('git', ['branch', branchName, 'main'], {
        cwd: workDir,
      });
    });

    it('should throw error if branch already exists', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: A branch named feature/new-feature already exists'));

      await expect(branches.createBranch(workDir, branchName)).rejects.toThrow();
    });
  });

  describe('checkoutBranch', () => {
    const workDir = '/test/repo';
    const branchName = 'feature/test';

    it('should checkout existing branch', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Switched to branch feature/test',
        stderr: '',
      } as any);

      await branches.checkoutBranch(workDir, branchName);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['checkout', branchName], {
        cwd: workDir,
      });
    });

    it('should create and checkout new branch', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Switched to a new branch feature/new',
        stderr: '',
      } as any);

      await branches.checkoutBranch(workDir, 'feature/new', true);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['checkout', '-b', 'feature/new'], {
        cwd: workDir,
      });
    });

    it('should throw error if branch does not exist', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('error: pathspec \'nonexistent\' did not match any file(s) known to git'));

      await expect(branches.checkoutBranch(workDir, 'nonexistent')).rejects.toThrow();
    });
  });

  describe('deleteBranch', () => {
    const workDir = '/test/repo';
    const branchName = 'feature/old';

    it('should delete branch safely', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Deleted branch feature/old',
        stderr: '',
      } as any);

      await branches.deleteBranch(workDir, branchName);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['branch', '-d', branchName], {
        cwd: workDir,
      });
    });

    it('should force delete branch', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Deleted branch feature/old (was abc1234)',
        stderr: '',
      } as any);

      await branches.deleteBranch(workDir, branchName, true);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['branch', '-D', branchName], {
        cwd: workDir,
      });
    });

    it('should throw error if branch is not fully merged', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('error: The branch feature/old is not fully merged'));

      await expect(branches.deleteBranch(workDir, branchName)).rejects.toThrow();
    });
  });

  describe('branchExists', () => {
    const workDir = '/test/repo';

    it('should return true if branch exists', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'abc1234',
        stderr: '',
      } as any);

      const exists = await branches.branchExists(workDir, 'main');

      expect(exists).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith('git', ['rev-parse', '--verify', 'main'], {
        cwd: workDir,
      });
    });

    it('should return false if branch does not exist', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: Needed a single revision'));

      const exists = await branches.branchExists(workDir, 'nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('getBranchTracking', () => {
    const workDir = '/test/repo';
    const branchName = 'feature/test';

    it('should get branch tracking info when upstream exists', async () => {
      mockedExeca
        .mockResolvedValueOnce({
          stdout: 'origin/feature/test\n',
          stderr: '',
        } as any)
        .mockResolvedValueOnce({
          stdout: '2\t5\n',
          stderr: '',
        } as any);

      const result = await branches.getBranchTracking(workDir, branchName);

      expect(result).toEqual({
        upstream: 'origin/feature/test',
        ahead: 5,
        behind: 2,
      });
      expect(mockedExeca).toHaveBeenCalledTimes(2);
    });

    it('should return zeros when branch has no upstream', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: no upstream'));

      const result = await branches.getBranchTracking(workDir, branchName);

      expect(result).toEqual({
        upstream: null,
        ahead: 0,
        behind: 0,
      });
    });
  });

  describe('pushBranch', () => {
    const workDir = '/test/repo';
    const branchName = 'feature/test';

    it('should push branch to remote', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'To github.com:test/repo.git\n * [new branch]      feature/test -> feature/test',
        stderr: '',
      } as any);

      await branches.pushBranch(workDir, branchName);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['push', 'origin', branchName], {
        cwd: workDir,
      });
    });

    it('should push branch with upstream set', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'To github.com:test/repo.git\n * [new branch]      feature/test -> feature/test\nBranch feature/test set up to track remote branch feature/test from origin.',
        stderr: '',
      } as any);

      await branches.pushBranch(workDir, branchName, 'origin', true);

      const callArgs = mockedExeca.mock.calls[0]?.[1] as string[];
      expect(callArgs[0]).toBe('push');
      expect(callArgs).toContain('-u');
      expect(callArgs).toContain('origin');
      expect(callArgs).toContain(branchName);
    });

    it('should push to custom remote', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await branches.pushBranch(workDir, branchName, 'upstream');

      expect(mockedExeca).toHaveBeenCalledWith('git', ['push', 'upstream', branchName], {
        cwd: workDir,
      });
    });

    it('should throw error if push fails', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('fatal: The current branch feature/test has no upstream branch'));

      await expect(branches.pushBranch(workDir, branchName)).rejects.toThrow();
    });
  });

  describe('createFeatureBranch', () => {
    const workDir = '/test/repo';
    const storyId = 'STORY-123';
    const description = 'Add User Authentication';

    it('should create feature branch with normalized name', async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: 'Switched to branch main', stderr: '' } as any)
        .mockRejectedValueOnce(new Error('no upstream')) // git pull fails
        .mockResolvedValueOnce({ stdout: 'Switched to a new branch', stderr: '' } as any);

      const result = await branches.createFeatureBranch(workDir, storyId, description);

      expect(result).toBe('feature/story-123-add-user-authentication');
      expect(mockedExeca).toHaveBeenCalledTimes(3);
    });

    it('should truncate long descriptions to 30 chars', async () => {
      const longDescription = 'This is a very long description that should be truncated to maintain reasonable branch name length';
      mockedExeca
        .mockResolvedValueOnce({ stdout: 'Switched to branch main', stderr: '' } as any)
        .mockRejectedValueOnce(new Error('no upstream'))
        .mockResolvedValueOnce({ stdout: 'Switched to a new branch', stderr: '' } as any);

      const result = await branches.createFeatureBranch(workDir, storyId, longDescription);

      expect(result).toBe('feature/story-123-this-is-a-very-long-descriptio');
    });

    it('should handle descriptions with special characters', async () => {
      const specialDescription = 'Fix: API@#$% rate-limiting & caching!';
      mockedExeca
        .mockResolvedValueOnce({ stdout: 'Switched to branch main', stderr: '' } as any)
        .mockRejectedValueOnce(new Error('no upstream'))
        .mockResolvedValueOnce({ stdout: 'Switched to a new branch', stderr: '' } as any);

      const result = await branches.createFeatureBranch(workDir, storyId, specialDescription);

      expect(result).toBe('feature/story-123-fix-api-rate-limiting-caching');
    });

    it('should use custom base branch', async () => {
      mockedExeca
        .mockResolvedValueOnce({ stdout: 'Switched to branch develop', stderr: '' } as any)
        .mockResolvedValueOnce({ stdout: 'Already up to date', stderr: '' } as any)
        .mockResolvedValueOnce({ stdout: 'Switched to a new branch', stderr: '' } as any);

      const result = await branches.createFeatureBranch(workDir, storyId, description, 'develop');

      expect(result).toBe('feature/story-123-add-user-authentication');
      const firstCall = mockedExeca.mock.calls[0];
      expect(firstCall[1]).toContain('develop');
    });
  });

  describe('mergeBranch', () => {
    const workDir = '/test/repo';
    const branchName = 'feature/test';

    it('should merge branch with no-ff flag', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Merge made by the recursive strategy',
        stderr: '',
      } as any);

      await branches.mergeBranch(workDir, branchName);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['merge', '--no-ff', branchName], {
        cwd: workDir,
      });
    });

    it('should merge branch without no-ff flag when disabled', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Fast-forward',
        stderr: '',
      } as any);

      await branches.mergeBranch(workDir, branchName, false);

      expect(mockedExeca).toHaveBeenCalledWith('git', ['merge', branchName], {
        cwd: workDir,
      });
    });

    it('should throw error if merge has conflicts', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in file.txt'));

      await expect(branches.mergeBranch(workDir, branchName)).rejects.toThrow();
    });
  });
});
