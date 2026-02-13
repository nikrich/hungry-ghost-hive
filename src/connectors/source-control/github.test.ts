// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registry } from '../registry.js';
import { GitHubSourceControlConnector, register } from './github.js';

// Mock the underlying github.ts module
vi.mock('../../git/github.js', () => ({
  createPullRequest: vi.fn(),
  mergePullRequest: vi.fn(),
  listPullRequests: vi.fn(),
  getPullRequestDiff: vi.fn(),
  commentOnPullRequest: vi.fn(),
  getPullRequestReviews: vi.fn(),
  reviewPullRequest: vi.fn(),
}));

describe('GitHubSourceControlConnector', () => {
  let connector: GitHubSourceControlConnector;

  beforeEach(() => {
    connector = new GitHubSourceControlConnector();
    vi.clearAllMocks();
  });

  it('should have provider set to "github"', () => {
    expect(connector.provider).toBe('github');
  });

  describe('createPullRequest', () => {
    it('should delegate to github.createPullRequest', async () => {
      const { createPullRequest } = await import('../../git/github.js');
      vi.mocked(createPullRequest).mockResolvedValue({
        number: 42,
        url: 'https://github.com/test/repo/pull/42',
      });

      const result = await connector.createPullRequest('/work', {
        title: 'feat: add feature',
        body: 'Description',
        baseBranch: 'main',
        headBranch: 'feature/test',
        draft: false,
        labels: ['enhancement'],
      });

      expect(createPullRequest).toHaveBeenCalledWith('/work', {
        title: 'feat: add feature',
        body: 'Description',
        baseBranch: 'main',
        headBranch: 'feature/test',
        draft: false,
        labels: ['enhancement'],
      });
      expect(result).toEqual({ number: 42, url: 'https://github.com/test/repo/pull/42' });
    });
  });

  describe('mergePullRequest', () => {
    it('should delegate to github.mergePullRequest with options', async () => {
      const { mergePullRequest } = await import('../../git/github.js');
      vi.mocked(mergePullRequest).mockResolvedValue(undefined);

      await connector.mergePullRequest('/work', 42, { method: 'squash', deleteAfterMerge: true });

      expect(mergePullRequest).toHaveBeenCalledWith('/work', 42, {
        method: 'squash',
        deleteAfterMerge: true,
      });
    });

    it('should handle undefined options', async () => {
      const { mergePullRequest } = await import('../../git/github.js');
      vi.mocked(mergePullRequest).mockResolvedValue(undefined);

      await connector.mergePullRequest('/work', 42);

      expect(mergePullRequest).toHaveBeenCalledWith('/work', 42, {
        method: undefined,
        deleteAfterMerge: undefined,
      });
    });
  });

  describe('listPullRequests', () => {
    it('should delegate to github.listPullRequests', async () => {
      const { listPullRequests } = await import('../../git/github.js');
      const mockPRs = [
        {
          number: 1,
          url: 'https://github.com/test/repo/pull/1',
          title: 'PR 1',
          state: 'open' as const,
          headBranch: 'feature/a',
          baseBranch: 'main',
          additions: 10,
          deletions: 5,
          changedFiles: 2,
        },
      ];
      vi.mocked(listPullRequests).mockResolvedValue(mockPRs);

      const result = await connector.listPullRequests('/work', 'open');

      expect(listPullRequests).toHaveBeenCalledWith('/work', 'open');
      expect(result).toEqual(mockPRs);
    });

    it('should work without state parameter', async () => {
      const { listPullRequests } = await import('../../git/github.js');
      vi.mocked(listPullRequests).mockResolvedValue([]);

      await connector.listPullRequests('/work');

      expect(listPullRequests).toHaveBeenCalledWith('/work', undefined);
    });
  });

  describe('getPullRequestDiff', () => {
    it('should delegate to github.getPullRequestDiff', async () => {
      const { getPullRequestDiff } = await import('../../git/github.js');
      vi.mocked(getPullRequestDiff).mockResolvedValue('diff --git a/file.ts b/file.ts\n+added');

      const result = await connector.getPullRequestDiff('/work', 42);

      expect(getPullRequestDiff).toHaveBeenCalledWith('/work', 42);
      expect(result).toBe('diff --git a/file.ts b/file.ts\n+added');
    });
  });

  describe('addPRComment', () => {
    it('should delegate to github.commentOnPullRequest', async () => {
      const { commentOnPullRequest } = await import('../../git/github.js');
      vi.mocked(commentOnPullRequest).mockResolvedValue(undefined);

      await connector.addPRComment('/work', 42, 'LGTM!');

      expect(commentOnPullRequest).toHaveBeenCalledWith('/work', 42, 'LGTM!');
    });
  });

  describe('getPRReviews', () => {
    it('should map review states to lowercase connector format', async () => {
      const { getPullRequestReviews } = await import('../../git/github.js');
      vi.mocked(getPullRequestReviews).mockResolvedValue([
        { author: 'alice', state: 'APPROVED', body: 'Looks good' },
        { author: 'bob', state: 'CHANGES_REQUESTED', body: 'Needs work' },
        { author: 'charlie', state: 'COMMENTED', body: 'Question' },
      ]);

      const result = await connector.getPRReviews('/work', 42);

      expect(getPullRequestReviews).toHaveBeenCalledWith('/work', 42);
      expect(result).toEqual([
        { author: 'alice', state: 'approved', body: 'Looks good' },
        { author: 'bob', state: 'changes_requested', body: 'Needs work' },
        { author: 'charlie', state: 'commented', body: 'Question' },
      ]);
    });

    it('should return empty array when no reviews', async () => {
      const { getPullRequestReviews } = await import('../../git/github.js');
      vi.mocked(getPullRequestReviews).mockResolvedValue([]);

      const result = await connector.getPRReviews('/work', 42);
      expect(result).toEqual([]);
    });
  });

  describe('approvePullRequest', () => {
    it('should delegate to github.reviewPullRequest with APPROVED state', async () => {
      const { reviewPullRequest } = await import('../../git/github.js');
      vi.mocked(reviewPullRequest).mockResolvedValue(undefined);

      await connector.approvePullRequest('/work', 42, 'Ship it!');

      expect(reviewPullRequest).toHaveBeenCalledWith('/work', 42, {
        state: 'APPROVED',
        body: 'Ship it!',
      });
    });

    it('should use empty string body when none provided', async () => {
      const { reviewPullRequest } = await import('../../git/github.js');
      vi.mocked(reviewPullRequest).mockResolvedValue(undefined);

      await connector.approvePullRequest('/work', 42);

      expect(reviewPullRequest).toHaveBeenCalledWith('/work', 42, {
        state: 'APPROVED',
        body: '',
      });
    });
  });
});

describe('register', () => {
  afterEach(() => {
    registry.reset();
  });

  it('should register the GitHub source control connector', () => {
    register();

    const connector = registry.getSourceControl('github');
    expect(connector).toBeInstanceOf(GitHubSourceControlConnector);
    expect(connector?.provider).toBe('github');
  });

  it('should lazily instantiate the connector', () => {
    register();

    // Registry should have the factory registered
    const providers = registry.listSourceControlProviders();
    expect(providers).toContain('github');
  });
});
