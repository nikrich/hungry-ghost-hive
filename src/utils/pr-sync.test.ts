// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequest } from '../db/queries/pull-requests.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { ensureQueueGitHubPRLinks, getExistingPRIdentifiers, syncOpenGitHubPRs } from './pr-sync.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

let db: Database;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await createTestDatabase();
});

describe('getExistingPRIdentifiers', () => {
  it('should return empty sets when no PRs exist', () => {
    const { existingBranches, existingPrNumbers } = getExistingPRIdentifiers(db);

    expect(existingBranches.size).toBe(0);
    expect(existingPrNumbers.size).toBe(0);
  });

  it('should include all branch names when includeTerminalBranches is true', () => {
    createPullRequest(db, { branchName: 'feature/open', githubPrNumber: 1 });
    const mergedPR = createPullRequest(db, {
      branchName: 'feature/merged',
      githubPrNumber: 2,
    });
    // Manually set status to merged
    db.run("UPDATE pull_requests SET status = 'merged' WHERE id = ?", [mergedPR.id]);

    const { existingBranches } = getExistingPRIdentifiers(db, true);

    expect(existingBranches.has('feature/open')).toBe(true);
    expect(existingBranches.has('feature/merged')).toBe(true);
  });

  it('should exclude terminal branch names when includeTerminalBranches is false', () => {
    createPullRequest(db, { branchName: 'feature/open', githubPrNumber: 1 });
    const mergedPR = createPullRequest(db, {
      branchName: 'feature/merged',
      githubPrNumber: 2,
    });
    const closedPR = createPullRequest(db, {
      branchName: 'feature/closed',
      githubPrNumber: 3,
    });
    db.run("UPDATE pull_requests SET status = 'merged' WHERE id = ?", [mergedPR.id]);
    db.run("UPDATE pull_requests SET status = 'closed' WHERE id = ?", [closedPR.id]);

    const { existingBranches } = getExistingPRIdentifiers(db, false);

    expect(existingBranches.has('feature/open')).toBe(true);
    expect(existingBranches.has('feature/merged')).toBe(false);
    expect(existingBranches.has('feature/closed')).toBe(false);
  });

  it('should collect PR numbers and filter out nulls', () => {
    createPullRequest(db, { branchName: 'feature/a', githubPrNumber: 42 });
    createPullRequest(db, { branchName: 'feature/b', githubPrNumber: null });
    createPullRequest(db, { branchName: 'feature/c', githubPrNumber: 99 });

    const { existingPrNumbers } = getExistingPRIdentifiers(db);

    expect(existingPrNumbers.has(42)).toBe(true);
    expect(existingPrNumbers.has(99)).toBe(true);
    expect(existingPrNumbers.size).toBe(2);
  });
});

describe('syncOpenGitHubPRs', () => {
  it('should import new PRs from GitHub', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/new-one',
          url: 'https://github.com/test/repo/pull/10',
          title: 'New PR',
        },
      ]),
    } as any);

    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(1);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].number).toBe(10);
    expect(result.imported[0].branch).toBe('feature/new-one');
  });

  it('should skip PRs with existing branch names', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/existing',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Existing',
        },
        {
          number: 11,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/11',
          title: 'New',
        },
      ]),
    } as any);

    const existingBranches = new Set(['feature/existing']);
    const result = await syncOpenGitHubPRs(db, '/repo', null, existingBranches, new Set());

    expect(result.synced).toBe(1);
    expect(result.imported[0].branch).toBe('feature/new');
  });

  it('should skip PRs with existing PR numbers', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/dup-num',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Dup',
        },
        {
          number: 11,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/11',
          title: 'New',
        },
      ]),
    } as any);

    const existingPrNumbers = new Set([10]);
    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), existingPrNumbers);

    expect(result.synced).toBe(1);
    expect(result.imported[0].number).toBe(11);
  });

  it('should update identifier sets to avoid duplicate imports across sequential sync calls', async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 10,
            headRefName: 'feature/shared',
            url: 'https://github.com/test/repo/pull/10',
            title: 'Shared PR',
          },
        ]),
      } as any)
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 10,
            headRefName: 'feature/shared',
            url: 'https://github.com/test/repo/pull/10',
            title: 'Shared PR',
          },
        ]),
      } as any);

    const existingBranches = new Set<string>();
    const existingPrNumbers = new Set<number>();

    const first = await syncOpenGitHubPRs(db, '/repo-a', null, existingBranches, existingPrNumbers);
    const second = await syncOpenGitHubPRs(
      db,
      '/repo-b',
      null,
      existingBranches,
      existingPrNumbers
    );

    expect(first.synced).toBe(1);
    expect(second.synced).toBe(0);
    expect(existingBranches.has('feature/shared')).toBe(true);
    expect(existingPrNumbers.has(10)).toBe(true);

    const countResult = db.exec('SELECT COUNT(*) as count FROM pull_requests');
    expect(countResult[0].values[0][0]).toBe(1);
  });

  it('should return empty results when no new PRs', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/existing',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Existing',
        },
      ]),
    } as any);

    const existingBranches = new Set(['feature/existing']);
    const result = await syncOpenGitHubPRs(db, '/repo', null, existingBranches, new Set());

    expect(result.synced).toBe(0);
    expect(result.imported).toHaveLength(0);
  });

  it('should associate PRs with provided team ID', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/10',
          title: 'New',
        },
      ]),
    } as any);

    // Create a team so foreign key is satisfied
    db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-1', 'https://test', 'repo', 'Test')"
    );

    const result = await syncOpenGitHubPRs(db, '/repo', 'team-1', new Set(), new Set());

    expect(result.synced).toBe(1);
    // Verify the PR was created with the team ID
    const prs = db.exec('SELECT team_id FROM pull_requests');
    expect(prs[0].values[0][0]).toBe('team-1');
  });

  it('should extract story IDs from branch names that match the story ID pattern', async () => {
    // Create a story so the FK constraint is satisfied
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-GOD-001', 'Test', 'Test', 'planned')"
    );

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'STORY-GOD-001',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Story PR',
        },
      ]),
    } as any);

    await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    const prs = db.exec('SELECT story_id FROM pull_requests');
    expect(prs[0].values[0][0]).toBe('STORY-GOD-001');
  });

  it('should set story_id to null for non-matching branch names', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/some-fix',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Fix',
        },
      ]),
    } as any);

    await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    const prs = db.exec('SELECT story_id FROM pull_requests');
    expect(prs[0].values[0][0]).toBeNull();
  });
});

describe('ensureQueueGitHubPRLinks', () => {
  it('links local queued PRs by creating GitHub PRs', async () => {
    db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-1', 'https://github.com/test/repo', 'repos/test-repo', 'Test')"
    );
    const localPr = createPullRequest(db, {
      teamId: 'team-1',
      branchName: 'feature/auto-link',
    });

    mockExeca
      .mockResolvedValueOnce({ stdout: 'origin/main', stderr: '' } as any)
      .mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/321',
        stderr: '',
      } as any);

    const result = await ensureQueueGitHubPRLinks('/root', db);

    expect(result.linked).toBe(1);
    expect(result.autoClosedNoDiff).toBe(0);
    expect(result.failed).toHaveLength(0);
    const updated = db.exec(
      `SELECT github_pr_number, github_pr_url FROM pull_requests WHERE id = '${localPr.id}'`
    );
    expect(updated[0].values[0][0]).toBe(321);
    expect(updated[0].values[0][1]).toBe('https://github.com/test/repo/pull/321');
    expect(mockExeca).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['pr', 'create', '--head', 'feature/auto-link', '--fill', '--base', 'main'],
      { cwd: '/root/repos/test-repo' }
    );
  });

  it('links local queued PRs by falling back to gh pr view when PR already exists', async () => {
    db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-1', 'https://github.com/test/repo', 'repos/test-repo', 'Test')"
    );
    const localPr = createPullRequest(db, {
      teamId: 'team-1',
      branchName: 'feature/existing',
    });

    const createErr = Object.assign(new Error('already exists'), {
      stderr: 'a pull request for branch "feature/existing" already exists',
    });

    mockExeca
      .mockResolvedValueOnce({ stdout: 'origin/main', stderr: '' } as any)
      .mockRejectedValueOnce(createErr)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ number: 456, url: 'https://github.com/test/repo/pull/456' }),
        stderr: '',
      } as any);

    const result = await ensureQueueGitHubPRLinks('/root', db);

    expect(result.linked).toBe(1);
    expect(result.autoClosedNoDiff).toBe(0);
    expect(result.failed).toHaveLength(0);
    const updated = db.exec(
      `SELECT github_pr_number, github_pr_url FROM pull_requests WHERE id = '${localPr.id}'`
    );
    expect(updated[0].values[0][0]).toBe(456);
    expect(updated[0].values[0][1]).toBe('https://github.com/test/repo/pull/456');
  });

  it('reports failures when linking a local queued PR fails', async () => {
    db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-1', 'https://github.com/test/repo', 'repos/test-repo', 'Test')"
    );
    const localPr = createPullRequest(db, {
      teamId: 'team-1',
      branchName: 'feature/fails',
    });

    mockExeca
      .mockResolvedValueOnce({ stdout: 'origin/main', stderr: '' } as any)
      .mockRejectedValueOnce(new Error('gh auth failed'));

    const result = await ensureQueueGitHubPRLinks('/root', db);

    expect(result.linked).toBe(0);
    expect(result.autoClosedNoDiff).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].prId).toBe(localPr.id);
    const updated = db.exec(
      `SELECT github_pr_number, github_pr_url FROM pull_requests WHERE id = '${localPr.id}'`
    );
    expect(updated[0].values[0][0]).toBeNull();
    expect(updated[0].values[0][1]).toBeNull();
  });

  it('auto-closes queued PR and reopens story when branch has no commits ahead of main', async () => {
    db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-1', 'https://github.com/test/repo', 'repos/test-repo', 'Test')"
    );
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-123', 'Story', 'desc', 'pr_submitted')"
    );
    const localPr = createPullRequest(db, {
      storyId: 'STORY-123',
      teamId: 'team-1',
      branchName: 'feature/no-commits',
    });

    const noCommitsErr = Object.assign(
      new Error('could not find any commits between origin/main and feature/no-commits'),
      { stderr: 'could not find any commits between origin/main and feature/no-commits' }
    );

    mockExeca
      .mockResolvedValueOnce({ stdout: 'origin/main', stderr: '' } as any)
      .mockRejectedValueOnce(noCommitsErr);

    const result = await ensureQueueGitHubPRLinks('/root', db);

    expect(result.linked).toBe(0);
    expect(result.autoClosedNoDiff).toBe(1);
    expect(result.failed).toHaveLength(0);

    const prRow = db.exec(
      `SELECT status, review_notes FROM pull_requests WHERE id = '${localPr.id}'`
    );
    expect(prRow[0].values[0][0]).toBe('closed');
    expect(String(prRow[0].values[0][1])).toContain('auto-closed:no-commits');

    const storyRow = db.exec("SELECT status FROM stories WHERE id = 'STORY-123'");
    expect(storyRow[0].values[0][0]).toBe('in_progress');
  });
});
