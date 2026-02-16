// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HiveConfig } from '../config/schema.js';
import { getLogsByEventType } from '../db/queries/logs.js';
import {
  createRequirement,
  getRequirementById,
  updateRequirement,
} from '../db/queries/requirements.js';
import { createStory } from '../db/queries/stories.js';
import { createTeam } from '../db/queries/teams.js';
import {
  createFeatureBranchPR,
  createRequirementFeatureBranch,
  getFeatureBranchName,
  getRequirementsNeedingFeatureBranch,
  isEligibleForFeatureBranch,
  requiresFeatureBranch,
} from './feature-branch.js';

// Mock execa for git operations
vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

// Mock GitHub PR creation
vi.mock('../git/github.js', () => ({
  createPullRequest: vi
    .fn()
    .mockResolvedValue({ number: 42, url: 'https://github.com/test/repo/pull/42' }),
}));

// Migration SQL to initialize database for tests
const INITIAL_MIGRATION = `
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    repo_url TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa', 'feature_test')),
    team_id TEXT REFERENCES teams(id),
    tmux_session TEXT,
    model TEXT,
    status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
    current_story_id TEXT,
    memory_state TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    requirement_id TEXT,
    team_id TEXT REFERENCES teams(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acceptance_criteria TEXT,
    complexity_score INTEGER CHECK (complexity_score BETWEEN 1 AND 13),
    story_points INTEGER,
    status TEXT DEFAULT 'draft' CHECK (status IN (
        'draft',
        'estimated',
        'planned',
        'in_progress',
        'review',
        'qa',
        'qa_failed',
        'pr_submitted',
        'merged'
    )),
    assigned_agent_id TEXT REFERENCES agents(id),
    branch_name TEXT,
    pr_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS story_dependencies (
    story_id TEXT REFERENCES stories(id),
    depends_on_story_id TEXT REFERENCES stories(id),
    PRIMARY KEY (story_id, depends_on_story_id)
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    story_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT,
    message TEXT,
    metadata TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    submitted_by TEXT DEFAULT 'human',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'planned', 'in_progress', 'completed', 'sign_off', 'sign_off_failed', 'sign_off_passed')),
    godmode INTEGER DEFAULT 0,
    target_branch TEXT DEFAULT 'main',
    feature_branch TEXT,
    jira_epic_key TEXT,
    jira_epic_id TEXT,
    external_epic_key TEXT,
    external_epic_id TEXT,
    external_provider TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

let db: Database;

const mockHiveConfigWithE2E: HiveConfig = {
  e2e_tests: { path: './e2e' },
} as HiveConfig;

const mockHiveConfigWithoutE2E: HiveConfig = {} as HiveConfig;

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run(INITIAL_MIGRATION);
  db.run("INSERT INTO migrations (name) VALUES ('001-initial.sql')");
  vi.clearAllMocks();
});

describe('getFeatureBranchName', () => {
  it('should generate correct feature branch name from requirement ID', () => {
    expect(getFeatureBranchName('REQ-ABCD1234')).toBe('feature/REQ-ABCD1234');
  });

  it('should preserve requirement ID case', () => {
    expect(getFeatureBranchName('REQ-XYZ')).toBe('feature/REQ-XYZ');
  });
});

describe('requiresFeatureBranch', () => {
  it('should return true when e2e_tests is configured', () => {
    expect(requiresFeatureBranch(mockHiveConfigWithE2E)).toBe(true);
  });

  it('should return false when e2e_tests is not configured', () => {
    expect(requiresFeatureBranch(mockHiveConfigWithoutE2E)).toBe(false);
  });

  it('should return false when hiveConfig is undefined', () => {
    expect(requiresFeatureBranch(undefined)).toBe(false);
  });
});

describe('isEligibleForFeatureBranch', () => {
  it('should return true for planned requirement with e2e_tests and no feature branch', () => {
    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });
    const updated = getRequirementById(db, req.id)!;

    expect(isEligibleForFeatureBranch(updated, mockHiveConfigWithE2E)).toBe(true);
  });

  it('should return false when requirement already has a feature branch', () => {
    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned', featureBranch: 'feature/REQ-123' });
    const updated = getRequirementById(db, req.id)!;

    expect(isEligibleForFeatureBranch(updated, mockHiveConfigWithE2E)).toBe(false);
  });

  it('should return false when requirement is not in planned status', () => {
    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'in_progress' });
    const updated = getRequirementById(db, req.id)!;

    expect(isEligibleForFeatureBranch(updated, mockHiveConfigWithE2E)).toBe(false);
  });

  it('should return false when e2e_tests is not configured', () => {
    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });
    const updated = getRequirementById(db, req.id)!;

    expect(isEligibleForFeatureBranch(updated, mockHiveConfigWithoutE2E)).toBe(false);
  });
});

describe('createRequirementFeatureBranch', () => {
  it('should create feature branch and update requirement', async () => {
    const { execa } = await import('execa');
    const mockExeca = vi.mocked(execa);

    const req = createRequirement(db, {
      title: 'Test Feature',
      description: 'Test feature req',
    });
    updateRequirement(db, req.id, { status: 'planned' });

    const saveFn = vi.fn();
    const result = await createRequirementFeatureBranch(db, '/tmp/repo', req.id, saveFn);

    expect(result).toBe(`feature/${req.id}`);

    // Verify git commands were called
    expect(mockExeca).toHaveBeenCalledWith('git', ['fetch', 'origin', 'main'], expect.any(Object));
    expect(mockExeca).toHaveBeenCalledWith(
      'git',
      ['branch', `feature/${req.id}`, 'origin/main'],
      expect.any(Object)
    );
    expect(mockExeca).toHaveBeenCalledWith(
      'git',
      ['push', 'origin', `feature/${req.id}`],
      expect.any(Object)
    );

    // Verify requirement was updated
    const updated = getRequirementById(db, req.id)!;
    expect(updated.feature_branch).toBe(`feature/${req.id}`);
    expect(updated.target_branch).toBe(`feature/${req.id}`);
    expect(updated.status).toBe('in_progress');

    // Verify save was called
    expect(saveFn).toHaveBeenCalled();

    // Verify log was created
    const logs = getLogsByEventType(db, 'FEATURE_BRANCH_CREATED');
    expect(logs.length).toBe(1);
    expect(logs[0].message).toContain(req.id);
  });

  it('should return null and log error for non-existent requirement', async () => {
    const result = await createRequirementFeatureBranch(db, '/tmp/repo', 'NON-EXISTENT');

    expect(result).toBeNull();

    const logs = getLogsByEventType(db, 'FEATURE_BRANCH_FAILED');
    expect(logs.length).toBe(1);
    expect(logs[0].message).toContain('not found');
  });

  it('should still transition to in_progress on git failure', async () => {
    const { execa } = await import('execa');
    const mockExeca = vi.mocked(execa);
    // Make git branch command fail
    mockExeca.mockRejectedValueOnce(new Error('fetch failed')); // fetch (non-fatal)
    mockExeca.mockRejectedValueOnce(new Error('branch already exists'));

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });

    const result = await createRequirementFeatureBranch(db, '/tmp/repo', req.id);

    expect(result).toBeNull();

    // Requirement should still transition to in_progress as a fallback
    const updated = getRequirementById(db, req.id)!;
    expect(updated.status).toBe('in_progress');
    // feature_branch should NOT be set on failure
    expect(updated.feature_branch).toBeNull();

    const logs = getLogsByEventType(db, 'FEATURE_BRANCH_FAILED');
    expect(logs.length).toBe(1);
  });

  it('should handle fetch failure gracefully and still create branch', async () => {
    const { execa } = await import('execa');
    const mockExeca = vi.mocked(execa);
    // First call (fetch) fails
    mockExeca.mockRejectedValueOnce(new Error('fetch failed'));
    // Subsequent calls (branch, push) succeed
    mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);
    mockExeca.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });

    const result = await createRequirementFeatureBranch(db, '/tmp/repo', req.id);

    expect(result).toBe(`feature/${req.id}`);
  });
});

describe('createFeatureBranchPR', () => {
  it('should create PR from feature branch to main', async () => {
    const { createPullRequest } = await import('../git/github.js');

    const req = createRequirement(db, {
      title: 'Test Feature',
      description: 'Test feature req',
    });
    updateRequirement(db, req.id, {
      status: 'sign_off_passed',
      featureBranch: `feature/${req.id}`,
    });

    const updated = getRequirementById(db, req.id)!;
    const result = await createFeatureBranchPR('/tmp/repo', updated);

    expect(result).not.toBeNull();
    expect(result!.number).toBe(42);
    expect(result!.url).toBe('https://github.com/test/repo/pull/42');

    expect(createPullRequest).toHaveBeenCalledWith('/tmp/repo', {
      title: expect.stringContaining(`feature/${req.id}`),
      body: expect.stringContaining(req.id),
      baseBranch: 'main',
      headBranch: `feature/${req.id}`,
    });
  });

  it('should return null when requirement has no feature branch', async () => {
    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    const updated = getRequirementById(db, req.id)!;

    const result = await createFeatureBranchPR('/tmp/repo', updated);
    expect(result).toBeNull();
  });

  it('should return null on PR creation failure', async () => {
    const { createPullRequest } = await import('../git/github.js');
    vi.mocked(createPullRequest).mockRejectedValueOnce(new Error('PR creation failed'));

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
      featureBranch: 'feature/REQ-TEST',
    });

    const updated = getRequirementById(db, req.id)!;
    const result = await createFeatureBranchPR('/tmp/repo', updated);
    expect(result).toBeNull();
  });
});

describe('getRequirementsNeedingFeatureBranch', () => {
  it('should return requirement IDs for stories with eligible requirements', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });

    const story = createStory(db, {
      teamId: team.id,
      title: 'Story 1',
      description: 'Test',
      requirementId: req.id,
    });

    const result = getRequirementsNeedingFeatureBranch(db, [story.id], mockHiveConfigWithE2E);

    expect(result).toEqual([req.id]);
  });

  it('should not return requirements that already have feature branches', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned', featureBranch: 'feature/REQ-123' });

    const story = createStory(db, {
      teamId: team.id,
      title: 'Story 1',
      description: 'Test',
      requirementId: req.id,
    });

    const result = getRequirementsNeedingFeatureBranch(db, [story.id], mockHiveConfigWithE2E);

    expect(result).toEqual([]);
  });

  it('should return empty array when e2e_tests is not configured', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });

    const story = createStory(db, {
      teamId: team.id,
      title: 'Story 1',
      description: 'Test',
      requirementId: req.id,
    });

    const result = getRequirementsNeedingFeatureBranch(db, [story.id], mockHiveConfigWithoutE2E);

    expect(result).toEqual([]);
  });

  it('should deduplicate requirements from multiple stories', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const req = createRequirement(db, {
      title: 'Test',
      description: 'Test req',
    });
    updateRequirement(db, req.id, { status: 'planned' });

    const story1 = createStory(db, {
      teamId: team.id,
      title: 'Story 1',
      description: 'Test',
      requirementId: req.id,
    });
    const story2 = createStory(db, {
      teamId: team.id,
      title: 'Story 2',
      description: 'Test',
      requirementId: req.id,
    });

    const result = getRequirementsNeedingFeatureBranch(
      db,
      [story1.id, story2.id],
      mockHiveConfigWithE2E
    );

    // Should only return the requirement once, not twice
    expect(result).toEqual([req.id]);
  });

  it('should return empty array for empty story list', () => {
    const result = getRequirementsNeedingFeatureBranch(db, [], mockHiveConfigWithE2E);
    expect(result).toEqual([]);
  });

  it('should skip stories without requirement_id', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const story = createStory(db, {
      teamId: team.id,
      title: 'Story without requirement',
      description: 'Test',
    });

    const result = getRequirementsNeedingFeatureBranch(db, [story.id], mockHiveConfigWithE2E);

    expect(result).toEqual([]);
  });

  it('should handle multiple requirements from different stories', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const req1 = createRequirement(db, {
      title: 'Req 1',
      description: 'Test req 1',
    });
    updateRequirement(db, req1.id, { status: 'planned' });

    const req2 = createRequirement(db, {
      title: 'Req 2',
      description: 'Test req 2',
    });
    updateRequirement(db, req2.id, { status: 'planned' });

    const story1 = createStory(db, {
      teamId: team.id,
      title: 'Story 1',
      description: 'Test',
      requirementId: req1.id,
    });
    const story2 = createStory(db, {
      teamId: team.id,
      title: 'Story 2',
      description: 'Test',
      requirementId: req2.id,
    });

    const result = getRequirementsNeedingFeatureBranch(
      db,
      [story1.id, story2.id],
      mockHiveConfigWithE2E
    );

    expect(result).toHaveLength(2);
    expect(result).toContain(req1.id);
    expect(result).toContain(req2.id);
  });
});
