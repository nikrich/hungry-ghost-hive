// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequest } from '../db/queries/pull-requests.js';
import { createTestDatabase } from '../db/queries/test-helpers.js';
import { closeStaleGitHubPRs, getExistingPRIdentifiers, syncOpenGitHubPRs } from './pr-sync.js';

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
  db.run("INSERT INTO agents (id, type, status) VALUES ('manager', 'tech_lead', 'idle')");
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
        },
        {
          number: 11,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/11',
          title: 'New',
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
        },
        {
          number: 11,
          headRefName: 'feature/new',
          url: 'https://github.com/test/repo/pull/11',
          title: 'New',
          createdAt: recentTimestamp,
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
            createdAt: recentTimestamp,
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
            createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
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
          createdAt: recentTimestamp,
        },
        {
          number: 11,
          headRefName: 'STORY-MERGED-001',
          url: 'https://github.com/test/repo/pull/11',
          title: 'Merged PR',
          createdAt: recentTimestamp,
        },
        {
          number: 12,
          headRefName: 'STORY-MISSING-001',
          url: 'https://github.com/test/repo/pull/12',
          title: 'Missing PR',
          createdAt: recentTimestamp,
        },
        {
          number: 13,
          headRefName: 'feature/no-story',
          url: 'https://github.com/test/repo/pull/13',
          title: 'No Story PR',
          createdAt: recentTimestamp,
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
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/old-pr',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Old PR',
          createdAt: oldTimestamp,
        },
        {
          number: 11,
          headRefName: 'feature/recent-pr',
          url: 'https://github.com/test/repo/pull/11',
          title: 'Recent PR',
          createdAt: recentTimestamp,
        },
      ]),
    } as any);

    const maxAgeHours = 168; // 7 days
    const result = await syncOpenGitHubPRs(
      db,
      '/repo',
      null,
      new Set(),
      new Set(),
      null,
      maxAgeHours
    );

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
          createdAt: oldPRTimestamp,
        },
      ]),
    } as any);

    // No maxAgeHours parameter - should import all PRs
    const result = await syncOpenGitHubPRs(db, '/repo', null, new Set(), new Set());

    expect(result.synced).toBe(1);
    expect(result.imported).toHaveLength(1);
  });

  it('should log PR_SYNC_SKIPPED events for old PRs', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/old-pr',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Old PR',
          createdAt: oldTimestamp,
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
          createdAt: recentTimestamp,
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

describe('closeStaleGitHubPRs', () => {
  beforeEach(() => {
    // Insert a team so the function can iterate teams
    db.run(
      "INSERT INTO teams (id, repo_url, repo_path, name) VALUES ('team-1', 'https://github.com/test/repo', 'repos/test', 'Test')"
    );
  });

  it('should return empty array when no teams exist', async () => {
    // Remove the team inserted in beforeEach
    db.run("DELETE FROM teams WHERE id = 'team-1'");

    const result = await closeStaleGitHubPRs('/root', db);

    expect(result).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it('should return empty array when no open GitHub PRs exist', async () => {
    mockExeca.mockResolvedValue({ stdout: JSON.stringify([]) } as any);

    const result = await closeStaleGitHubPRs('/root', db);

    expect(result).toEqual([]);
  });

  it('should skip open GitHub PRs without a story ID', async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/no-story',
          baseRefName: 'main',
          url: 'https://github.com/test/repo/pull/10',
          title: 'No story',
          createdAt: new Date().toISOString(),
        },
      ]),
    } as any);

    const result = await closeStaleGitHubPRs('/root', db);

    expect(result).toEqual([]);
  });

  it('should skip a GitHub PR that is already in the queue', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-001', 'Test', 'Test', 'in_progress')"
    );
    const pr = createPullRequest(db, {
      storyId: 'STORY-TST-001',
      branchName: 'feature/STORY-TST-001-work',
      githubPrNumber: 10,
    });
    expect(pr).toBeDefined();

    mockExeca.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/STORY-TST-001-work',
          baseRefName: 'main',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Test PR',
          createdAt: new Date().toISOString(),
        },
      ]),
    } as any);

    const result = await closeStaleGitHubPRs('/root', db);

    expect(result).toEqual([]);
    // gh pr close should NOT have been called
    const closeCalls = mockExeca.mock.calls.filter(
      call => call[0] === 'gh' && Array.isArray(call[1]) && call[1].includes('close')
    );
    expect(closeCalls).toHaveLength(0);
  });

  it('should close a stale GitHub PR and return ClosedPRInfo', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-002', 'Test', 'Test', 'in_progress')"
    );
    // Queue PR has github_pr_number 20 (the newer one)
    createPullRequest(db, {
      storyId: 'STORY-TST-002',
      branchName: 'feature/STORY-TST-002-v2',
      githubPrNumber: 20,
    });

    // GitHub still has the old PR #10 open
    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 10,
            headRefName: 'feature/STORY-TST-002-v1',
            baseRefName: 'main',
            url: 'https://github.com/test/repo/pull/10',
            title: 'Old PR',
            createdAt: new Date().toISOString(),
          },
        ]),
      } as any)
      .mockResolvedValueOnce({ stdout: '' } as any); // gh pr close succeeds

    const result = await closeStaleGitHubPRs('/root', db);

    expect(result).toHaveLength(1);
    expect(result[0].storyId).toBe('STORY-TST-002');
    expect(result[0].closedPrNumber).toBe(10);
    expect(result[0].branch).toBe('feature/STORY-TST-002-v1');
    expect(result[0].supersededByPrNumber).toBe(20);
  });

  it('should include superseding PR number in the log message', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-003', 'Test', 'Test', 'in_progress')"
    );
    createPullRequest(db, {
      storyId: 'STORY-TST-003',
      branchName: 'feature/STORY-TST-003-v2',
      githubPrNumber: 30,
    });

    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 15,
            headRefName: 'feature/STORY-TST-003-v1',
            baseRefName: 'main',
            url: 'https://github.com/test/repo/pull/15',
            title: 'Old PR',
            createdAt: new Date().toISOString(),
          },
        ]),
      } as any)
      .mockResolvedValueOnce({ stdout: '' } as any);

    await closeStaleGitHubPRs('/root', db);

    const logs = db.exec("SELECT message, metadata FROM agent_logs WHERE event_type = 'PR_CLOSED'");
    expect(logs.length).toBeGreaterThan(0);
    const message = logs[0].values[0][0] as string;
    expect(message).toContain('#15');
    expect(message).toContain('by PR #30');

    const metadata = JSON.parse(logs[0].values[0][1] as string) as Record<string, unknown>;
    expect(metadata.superseded_by_pr_number).toBe(30);
  });

  it('should not close if gh CLI throws and should not include in result', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-004', 'Test', 'Test', 'in_progress')"
    );
    createPullRequest(db, {
      storyId: 'STORY-TST-004',
      branchName: 'feature/STORY-TST-004-v2',
      githubPrNumber: 40,
    });

    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 5,
            headRefName: 'feature/STORY-TST-004-v1',
            baseRefName: 'main',
            url: 'https://github.com/test/repo/pull/5',
            title: 'Old PR',
            createdAt: new Date().toISOString(),
          },
        ]),
      } as any)
      .mockRejectedValueOnce(new Error('gh CLI error') as never);

    const result = await closeStaleGitHubPRs('/root', db);

    // Non-fatal: result should be empty since close failed
    expect(result).toHaveLength(0);
  });

  it('should skip PRs not targeting the configured base branch', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-005', 'Test', 'Test', 'in_progress')"
    );
    createPullRequest(db, {
      storyId: 'STORY-TST-005',
      branchName: 'feature/STORY-TST-005-v2',
      githubPrNumber: 50,
    });

    // PR targets a feature branch, not main
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/STORY-TST-005-v1',
          baseRefName: 'feat/memento-refactor',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Feature branch PR',
          createdAt: new Date().toISOString(),
        },
      ]),
    } as any);

    const result = await closeStaleGitHubPRs('/root', db);

    // Should not close PRs targeting non-main branches
    expect(result).toHaveLength(0);
    const closeCalls = mockExeca.mock.calls.filter(
      call => call[0] === 'gh' && Array.isArray(call[1]) && call[1].includes('close')
    );
    expect(closeCalls).toHaveLength(0);
  });

  it('should only close PRs targeting the configured base branch when it is non-main', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-006', 'Test', 'Test', 'in_progress')"
    );
    createPullRequest(db, {
      storyId: 'STORY-TST-006',
      branchName: 'feature/STORY-TST-006-v2',
      githubPrNumber: 60,
    });

    // Old PR targets the configured base branch (feat/memento-refactor)
    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            number: 10,
            headRefName: 'feature/STORY-TST-006-v1',
            baseRefName: 'feat/memento-refactor',
            url: 'https://github.com/test/repo/pull/10',
            title: 'Old PR targeting feature base',
            createdAt: new Date().toISOString(),
          },
        ]),
      } as any)
      .mockResolvedValueOnce({ stdout: '' } as any);

    const result = await closeStaleGitHubPRs('/root', db, 'feat/memento-refactor');

    expect(result).toHaveLength(1);
    expect(result[0].closedPrNumber).toBe(10);
  });

  it('should not close PRs targeting main when configured base branch is feat/memento-refactor', async () => {
    db.run(
      "INSERT INTO stories (id, title, description, status) VALUES ('STORY-TST-007', 'Test', 'Test', 'in_progress')"
    );
    createPullRequest(db, {
      storyId: 'STORY-TST-007',
      branchName: 'feature/STORY-TST-007-v2',
      githubPrNumber: 70,
    });

    // PR targets main but configured base branch is feat/memento-refactor
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          number: 10,
          headRefName: 'feature/STORY-TST-007-v1',
          baseRefName: 'main',
          url: 'https://github.com/test/repo/pull/10',
          title: 'Main-targeting PR',
          createdAt: new Date().toISOString(),
        },
      ]),
    } as any);

    const result = await closeStaleGitHubPRs('/root', db, 'feat/memento-refactor');

    expect(result).toHaveLength(0);
  });
});
