import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as github from './github.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa as mockExeca } from 'execa';

const mockedExeca = vi.mocked(mockExeca);

describe('github module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isGitHubCLIAvailable', () => {
    it('should return true when gh CLI is available', async () => {
      mockedExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
      const available = await github.isGitHubCLIAvailable();
      expect(available).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith('gh', ['auth', 'status']);
    });

    it('should return false when gh CLI is not available', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('gh not found'));
      const available = await github.isGitHubCLIAvailable();
      expect(available).toBe(false);
    });
  });

  describe('createPullRequest', () => {
    const workDir = '/test/repo';
    const options = {
      title: 'Test PR',
      body: 'Test description',
      baseBranch: 'main',
      headBranch: 'feature/test',
    };

    it('should create a PR with basic options', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/123\n',
        stderr: '',
      } as any);

      const result = await github.createPullRequest(workDir, options);

      expect(result).toEqual({ number: 123, url: 'https://github.com/test/repo/pull/123' });
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        [
          'pr',
          'create',
          '--title',
          'Test PR',
          '--body',
          'Test description',
          '--base',
          'main',
          '--head',
          'feature/test',
        ],
        { cwd: workDir }
      );
    });

    it('should create a draft PR', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/124\n',
        stderr: '',
      } as any);

      const result = await github.createPullRequest(workDir, {
        ...options,
        draft: true,
      });

      expect(result.number).toBe(124);
      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--draft');
    });

    it('should create a PR with labels', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/125\n',
        stderr: '',
      } as any);

      const result = await github.createPullRequest(workDir, {
        ...options,
        labels: ['bug', 'urgent'],
      });

      expect(result.number).toBe(125);
      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--label');
      expect(callArgs).toContain('bug,urgent');
    });

    it('should create a PR with assignees', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/126\n',
        stderr: '',
      } as any);

      const result = await github.createPullRequest(workDir, {
        ...options,
        assignees: ['user1', 'user2'],
      });

      expect(result.number).toBe(126);
      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--assignee');
      expect(callArgs).toContain('user1,user2');
    });

    it('should handle PR number extraction from URL', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'https://github.com/nikrich/hungry-ghost-hive/pull/999\n',
        stderr: '',
      } as any);

      const result = await github.createPullRequest(workDir, options);
      expect(result.number).toBe(999);
    });

    it('should throw error if PR creation fails', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('PR already exists'));

      await expect(github.createPullRequest(workDir, options)).rejects.toThrow('PR already exists');
    });
  });

  describe('getPullRequest', () => {
    const workDir = '/test/repo';
    const prNumber = 123;

    it('should get PR information', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 123,
          url: 'https://github.com/test/repo/pull/123',
          title: 'Test PR',
          state: 'OPEN',
          headRefName: 'feature/test',
          baseRefName: 'main',
          additions: 42,
          deletions: 12,
          changedFiles: 3,
        }),
        stderr: '',
      } as any);

      const result = await github.getPullRequest(workDir, prNumber);

      expect(result).toEqual({
        number: 123,
        url: 'https://github.com/test/repo/pull/123',
        title: 'Test PR',
        state: 'open',
        headBranch: 'feature/test',
        baseBranch: 'main',
        additions: 42,
        deletions: 12,
        changedFiles: 3,
      });
    });

    it('should handle different PR states', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 124,
          url: 'https://github.com/test/repo/pull/124',
          title: 'Closed PR',
          state: 'CLOSED',
          headRefName: 'feature/test',
          baseRefName: 'main',
          additions: 0,
          deletions: 0,
          changedFiles: 0,
        }),
        stderr: '',
      } as any);

      const result = await github.getPullRequest(workDir, 124);
      expect(result.state).toBe('closed');
    });

    it('should throw error if PR view fails', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('PR not found'));

      await expect(github.getPullRequest(workDir, prNumber)).rejects.toThrow('PR not found');
    });

    it('should throw error if JSON parsing fails', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'invalid json',
        stderr: '',
      } as any);

      await expect(github.getPullRequest(workDir, prNumber)).rejects.toThrow();
    });
  });

  describe('listPullRequests', () => {
    const workDir = '/test/repo';

    it('should list open pull requests', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 123,
            url: 'https://github.com/test/repo/pull/123',
            title: 'PR 1',
            state: 'OPEN',
            headRefName: 'feature/test1',
            baseRefName: 'main',
            additions: 10,
            deletions: 5,
            changedFiles: 1,
          },
          {
            number: 124,
            url: 'https://github.com/test/repo/pull/124',
            title: 'PR 2',
            state: 'OPEN',
            headRefName: 'feature/test2',
            baseRefName: 'main',
            additions: 20,
            deletions: 10,
            changedFiles: 2,
          },
        ]),
        stderr: '',
      } as any);

      const result = await github.listPullRequests(workDir, 'open');

      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(123);
      expect(result[1].number).toBe(124);
      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'open',
          '--json',
          'number,url,title,state,headRefName,baseRefName,additions,deletions,changedFiles',
        ],
        { cwd: workDir }
      );
    });

    it('should list closed pull requests', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
        stderr: '',
      } as any);

      const result = await github.listPullRequests(workDir, 'closed');

      expect(result).toHaveLength(0);
      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--state');
      expect(callArgs).toContain('closed');
    });

    it('should default to open state', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
        stderr: '',
      } as any);

      await github.listPullRequests(workDir);

      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('open');
    });
  });

  describe('commentOnPullRequest', () => {
    const workDir = '/test/repo';
    const prNumber = 123;
    const comment = 'Test comment';

    it('should add a comment to a PR', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await github.commentOnPullRequest(workDir, prNumber, comment);

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['pr', 'comment', '123', '--body', 'Test comment'],
        { cwd: workDir }
      );
    });

    it('should throw error if comment fails', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('Failed to comment'));

      await expect(github.commentOnPullRequest(workDir, prNumber, comment)).rejects.toThrow(
        'Failed to comment'
      );
    });
  });

  describe('reviewPullRequest', () => {
    const workDir = '/test/repo';
    const prNumber = 123;

    it('should approve a PR', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await github.reviewPullRequest(workDir, prNumber, {
        state: 'APPROVED',
        body: 'Looks good!',
      });

      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--approve');
      expect(callArgs).toContain('--body');
      expect(callArgs).toContain('Looks good!');
    });

    it('should request changes on a PR', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await github.reviewPullRequest(workDir, prNumber, {
        state: 'CHANGES_REQUESTED',
        body: 'Needs fixes',
      });

      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--request-changes');
    });

    it('should add a comment review', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      } as any);

      await github.reviewPullRequest(workDir, prNumber, {
        state: 'COMMENTED',
        body: 'Just a comment',
      });

      const callArgs = mockedExeca.mock.calls[0][1];
      expect(callArgs).toContain('--comment');
    });
  });

  describe('mergePullRequest', () => {
    const workDir = '/test/repo';
    const prNumber = 123;

    it('should merge a PR', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Pull request #123 merged',
        stderr: '',
      } as any);

      await github.mergePullRequest(workDir, prNumber);

      expect(mockedExeca).toHaveBeenCalledWith(
        'gh',
        ['pr', 'merge', '123', '--auto', '--merge', '--delete-branch'],
        { cwd: workDir }
      );
    });

    it('should throw error if merge fails', async () => {
      mockedExeca.mockRejectedValueOnce(new Error('PR has conflicts'));

      await expect(github.mergePullRequest(workDir, prNumber)).rejects.toThrow('PR has conflicts');
    });
  });

  describe('closePullRequest', () => {
    const workDir = '/test/repo';
    const prNumber = 123;

    it('should close a PR', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'Pull request #123 closed',
        stderr: '',
      } as any);

      await github.closePullRequest(workDir, prNumber);

      expect(mockedExeca).toHaveBeenCalledWith('gh', ['pr', 'close', '123'], { cwd: workDir });
    });
  });

  describe('getPullRequestDiff', () => {
    const workDir = '/test/repo';
    const prNumber = 123;

    it('should get PR diff', async () => {
      const diffContent = 'diff --git a/file.txt b/file.txt\n+added line';
      mockedExeca.mockResolvedValueOnce({
        stdout: diffContent,
        stderr: '',
      } as any);

      const result = await github.getPullRequestDiff(workDir, prNumber);

      expect(result).toBe(diffContent);
      expect(mockedExeca).toHaveBeenCalledWith('gh', ['pr', 'diff', '123'], { cwd: workDir });
    });
  });

  describe('getPullRequestReviews', () => {
    const workDir = '/test/repo';
    const prNumber = 123;

    it('should get PR reviews', async () => {
      mockedExeca.mockResolvedValueOnce({
        stdout: JSON.stringify({
          reviews: [
            {
              author: 'reviewer1',
              state: 'APPROVED',
              body: 'Looks good',
            },
            {
              author: 'reviewer2',
              state: 'COMMENTED',
              body: 'Nice work',
            },
          ],
        }),
        stderr: '',
      } as any);

      const result = await github.getPullRequestReviews(workDir, prNumber);

      expect(result).toHaveLength(2);
      expect(result[0].state).toBe('APPROVED');
      expect(result[0].author).toBe('reviewer1');
    });
  });
});
