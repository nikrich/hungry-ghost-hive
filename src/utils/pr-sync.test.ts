import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequest } from '../db/queries/pull-requests.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { getExistingPRIdentifiers, syncOpenGitHubPRs } from './pr-sync.js';

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
