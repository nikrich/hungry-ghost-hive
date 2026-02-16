// Licensed under the Hungry Ghost Hive License. See LICENSE.

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
  // Create a 'manager' agent for logging (required by foreign key constraint)
  db.run(
    "INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')"
  );
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
  const recentTimestamp = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
  const oldTimestamp = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(); // 8 days ago

  it('should import new PRs from GitHub', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/new-one',
          url: 'https://github.com/test/repo/pull/10',
          title: 'New PR',
          updatedAt: recentTimestamp,
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
          updatedAt: recentTimestamp,
        },
        {
          number: 11,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/11',
          title: 'New',
          updatedAt: recentTimestamp,
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
          updatedAt: recentTimestamp,
        },
        {
          number: 11,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/11',
          title: 'New',
          updatedAt: recentTimestamp,
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
            updatedAt: recentTimestamp,
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
            updatedAt: recentTimestamp,
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
          updatedAt: recentTimestamp,
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
          updatedAt: recentTimestamp,
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
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    const prs = db.exec('SELECT story_id FROM pull_requests');
    expect(prs[0].values[0][0]).toBe('STORY-GOD-001');
  });

  it('should import PRs without story IDs (for manual/hotfix PRs)', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/some-fix',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Fix',
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(1);
    expect(result.imported).toHaveLength(1);

    // Verify the PR was created with null story_id
    const prs = db.exec('SELECT story_id FROM pull_requests');
    expect(prs[0].values[0][0]).toBeNull();
  });

  it('should skip PRs where story does not exist in database', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'STORY-MISSING-001',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Missing Story',
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(0);
    expect(result.imported).toHaveLength(0);
  });

  it('should skip PRs where story status is merged', async () => {
    // Create a merged story
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-MERGED-001', 'Merged Story', 'Test', 'merged')"
    );

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'STORY-MERGED-001',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Merged Story PR',
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(0);
    expect(result.imported).toHaveLength(0);
  });

  it('should import PRs with active (non-merged) stories', async () => {
    // Create an active story
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-ACTIVE-001', 'Active Story', 'Test', 'in_progress')"
    );

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'STORY-ACTIVE-001',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Active Story PR',
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(1);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].branch).toBe('STORY-ACTIVE-001');
  });

  it('should filter mixed PRs - import active stories and PRs without story IDs', async () => {
    // Create stories with different statuses
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-ACTIVE-001', 'Active', 'Test', 'planned')"
    );
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-MERGED-001', 'Merged', 'Test', 'merged')"
    );

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'STORY-ACTIVE-001',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Active PR',
          updatedAt: recentTimestamp,
        },
        {
          number: 11,
          headRefName: 'STORY-MERGED-001',
          url: 'https://github.com/test/repo/pull/11',
          title: 'Merged PR',
          updatedAt: recentTimestamp,
        },
        {
          number: 12,
          headRefName: 'STORY-MISSING-001',
          url: 'https://github.com/test/repo/pull/12',
          title: 'Missing PR',
          updatedAt: recentTimestamp,
        },
        {
          number: 13,
          headRefName: 'feature/no-story',
          url: 'https://github.com/test/repo/pull/13',
          title: 'No Story PR',
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(2);
    expect(result.imported).toHaveLength(2);
    // Active story PR and PR without story ID should be imported
    const branches = result.imported.map(pr => pr.branch).sort();
    expect(branches).toEqual(['STORY-ACTIVE-001', 'feature/no-story']);
  });

  it('should skip PRs older than maxAgeHours', async () => {
    const recentPRTimestamp = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    const oldPRTimestamp = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(); // 8 days ago

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/old-pr',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Old PR',
          updatedAt: oldPRTimestamp,
        },
        {
          number: 11,
          headRefName: 'feature/recent-pr',
          url: 'https://github.com/test/repo/pull/11',
          title: 'Recent PR',
          updatedAt: recentPRTimestamp,
        },
      ]),
    } as any);

    const maxAgeHours = 168; // 7 days
    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set(), null, maxAgeHours);

    expect(result.synced).toBe(1);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].branch).toBe('feature/recent-pr');
  });

  it('should import all PRs when maxAgeHours is not specified', async () => {
    const oldPRTimestamp = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(); // 30 days ago

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/very-old-pr',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Very Old PR',
          updatedAt: oldPRTimestamp,
        },
      ]),
    } as any);

    // No maxAgeHours parameter - should import all PRs
    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(1);
    expect(result.imported).toHaveLength(1);
  });

  it('should log PR_SYNC_SKIPPED events for old PRs', async () => {
    const oldPRTimestamp = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(); // 8 days ago

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/old-pr',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Old PR',
          updatedAt: oldPRTimestamp,
        },
      ]),
    } as any);

    const maxAgeHours = 168; // 7 days
    await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set(), null, maxAgeHours);

    // Check that a log entry was created
    const logs = db.exec("SELECT * FROM agent_logs WHERE event_type = 'PR_SYNC_SKIPPED'");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].values.length).toBeGreaterThan(0);
  });

  it('should log PR_SYNC_SKIPPED events for inactive stories', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'STORY-MISSING-999',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Missing Story PR',
          updatedAt: recentTimestamp,
        },
      ]),
    } as any);

    await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    // Check that a log entry was created
    const logs = db.exec("SELECT * FROM agent_logs WHERE event_type = 'PR_SYNC_SKIPPED'");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].values.length).toBeGreaterThan(0);
  });
});
