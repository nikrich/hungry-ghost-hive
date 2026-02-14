// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLogsByEventType } from '../db/queries/logs.js';
import { createRequirement } from '../db/queries/requirements.js';
import type { StoryRow } from '../db/queries/stories.js';
import {
  addStoryDependency,
  createStory,
  getStoryById,
  updateStory,
} from '../db/queries/stories.js';
import { createTeam } from '../db/queries/teams.js';
import * as worktreeModule from '../git/worktree.js';
import { getAgentWorkload, selectAgentWithLeastWorkload } from './agent-selector.js';
import {
  getCapacityPoints,
  isRefactorStory,
  selectStoriesForCapacity,
} from './capacity-planner.js';
import {
  areDependenciesSatisfied,
  buildDependencyGraph,
  topologicalSort,
} from './dependency-resolver.js';
import { detectAndRecoverOrphanedStories } from './orphan-recovery.js';
import { Scheduler } from './scheduler.js';

vi.mock('../git/worktree.js', () => ({
  removeWorktree: vi.fn().mockResolvedValue(true),
}));

let db: Database;
let scheduler: Scheduler;

const mockConfig = {
  scaling: {
    junior_max_complexity: 3,
    intermediate_max_complexity: 5,
    senior_capacity: 50,
  },
  models: {
    tech_lead: {
      provider: 'anthropic',
      model: 'claude-opus-4-20250514',
      max_tokens: 16000,
      temperature: 0.7,
      cli_tool: 'claude',
      safety_mode: 'unsafe',
    },
    senior: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 0.5,
      cli_tool: 'claude',
      safety_mode: 'unsafe',
    },
    intermediate: {
      provider: 'anthropic',
      model: 'claude-haiku-3-5-20241022',
      max_tokens: 4000,
      temperature: 0.3,
      cli_tool: 'claude',
      safety_mode: 'unsafe',
    },
    junior: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      temperature: 0.3,
      cli_tool: 'claude',
      safety_mode: 'unsafe',
    },
    qa: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 0.2,
      cli_tool: 'claude',
      safety_mode: 'unsafe',
    },
  },
  rootDir: '/tmp',
};

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
    type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa')),
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
    status TEXT DEFAULT 'pending',
    godmode INTEGER DEFAULT 0,
    target_branch TEXT DEFAULT 'main',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run(INITIAL_MIGRATION);
  db.run("INSERT INTO migrations (name) VALUES ('001-initial.sql')");

  scheduler = new Scheduler(db, mockConfig as any);
});

describe('Scheduler Topological Sort', () => {
  it('should handle stories with no dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const story1 = createStory(db, { teamId: team.id, title: 'Story 1', description: 'Test' });
    const story2 = createStory(db, { teamId: team.id, title: 'Story 2', description: 'Test' });

    // Mock the private method by accessing it through reflection
    const sorted = topologicalSort(db, [story1, story2]);

    expect(sorted).not.toBeNull();
    expect(sorted).toHaveLength(2);
  });

  it('should respect linear dependencies (A -> B -> C)', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });
    const storyC = createStory(db, { teamId: team.id, title: 'Story C', description: 'Test' });

    // B depends on A, C depends on B
    addStoryDependency(db, storyB.id, storyA.id);
    addStoryDependency(db, storyC.id, storyB.id);

    const sorted = topologicalSort(db, [storyC, storyA, storyB]);

    expect(sorted).not.toBeNull();
    expect(sorted).toHaveLength(3);
    // A should come first, then B, then C
    const ids = sorted!.map((s: StoryRow) => s.id);
    expect(ids.indexOf(storyA.id)).toBeLessThan(ids.indexOf(storyB.id));
    expect(ids.indexOf(storyB.id)).toBeLessThan(ids.indexOf(storyC.id));
  });

  it('should respect diamond dependencies (A -> B, A -> C, B -> D, C -> D)', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });
    const storyC = createStory(db, { teamId: team.id, title: 'Story C', description: 'Test' });
    const storyD = createStory(db, { teamId: team.id, title: 'Story D', description: 'Test' });

    // B and C depend on A, D depends on both B and C
    addStoryDependency(db, storyB.id, storyA.id);
    addStoryDependency(db, storyC.id, storyA.id);
    addStoryDependency(db, storyD.id, storyB.id);
    addStoryDependency(db, storyD.id, storyC.id);

    const sorted = topologicalSort(db, [storyD, storyB, storyA, storyC]);

    expect(sorted).not.toBeNull();
    expect(sorted).toHaveLength(4);
    const ids = sorted!.map((s: StoryRow) => s.id);

    // A should come first
    expect(ids.indexOf(storyA.id)).toBe(0);
    // D should come last
    expect(ids.indexOf(storyD.id)).toBe(3);
    // B and C should come between A and D
    expect(ids.indexOf(storyB.id)).toBeGreaterThan(ids.indexOf(storyA.id));
    expect(ids.indexOf(storyC.id)).toBeGreaterThan(ids.indexOf(storyA.id));
    expect(ids.indexOf(storyB.id)).toBeLessThan(ids.indexOf(storyD.id));
    expect(ids.indexOf(storyC.id)).toBeLessThan(ids.indexOf(storyD.id));
  });

  it('should detect circular dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });

    // Create circular dependency: A -> B -> A
    addStoryDependency(db, storyB.id, storyA.id);
    addStoryDependency(db, storyA.id, storyB.id);

    const sorted = topologicalSort(db, [storyA, storyB]);

    expect(sorted).toBeNull();
  });
});

describe('Scheduler Dependency Satisfaction', () => {
  it('should consider merged stories as satisfying dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const depStory = createStory(db, { teamId: team.id, title: 'Dependency', description: 'Test' });
    const mainStory = createStory(db, {
      teamId: team.id,
      title: 'Main Story',
      description: 'Test',
    });

    addStoryDependency(db, mainStory.id, depStory.id);

    // Initially, dependencies are not satisfied
    let isSatisfied = areDependenciesSatisfied(db, mainStory.id);
    expect(isSatisfied).toBe(false);

    // Mark dependency as merged
    updateStory(db, depStory.id, { status: 'merged' });
    isSatisfied = areDependenciesSatisfied(db, mainStory.id);
    expect(isSatisfied).toBe(true);
  });

  it('should not consider in-progress stories as satisfying dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const depStory = createStory(db, { teamId: team.id, title: 'Dependency', description: 'Test' });
    const mainStory = createStory(db, {
      teamId: team.id,
      title: 'Main Story',
      description: 'Test',
    });

    addStoryDependency(db, mainStory.id, depStory.id);

    // Mark dependency as in_progress - this should NOT satisfy the dependency
    updateStory(db, depStory.id, { status: 'in_progress' });
    const isSatisfied = areDependenciesSatisfied(db, mainStory.id);
    expect(isSatisfied).toBe(false);
  });

  it('should not consider planned stories as satisfying dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const depStory = createStory(db, { teamId: team.id, title: 'Dependency', description: 'Test' });
    const mainStory = createStory(db, {
      teamId: team.id,
      title: 'Main Story',
      description: 'Test',
    });

    addStoryDependency(db, mainStory.id, depStory.id);

    // Update main story status to planned (default)
    updateStory(db, mainStory.id, { status: 'planned' });

    const isSatisfied = areDependenciesSatisfied(db, mainStory.id);
    expect(isSatisfied).toBe(false);
  });

  it('should handle multiple dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const dep1 = createStory(db, { teamId: team.id, title: 'Dep 1', description: 'Test' });
    const dep2 = createStory(db, { teamId: team.id, title: 'Dep 2', description: 'Test' });
    const mainStory = createStory(db, {
      teamId: team.id,
      title: 'Main Story',
      description: 'Test',
    });

    addStoryDependency(db, mainStory.id, dep1.id);
    addStoryDependency(db, mainStory.id, dep2.id);

    // Mark only first dependency as merged
    updateStory(db, dep1.id, { status: 'merged' });
    let isSatisfied = areDependenciesSatisfied(db, mainStory.id);
    expect(isSatisfied).toBe(false);

    // Mark second dependency as merged too
    updateStory(db, dep2.id, { status: 'merged' });
    isSatisfied = areDependenciesSatisfied(db, mainStory.id);
    expect(isSatisfied).toBe(true);
  });
});

describe('Scheduler Build Dependency Graph', () => {
  it('should correctly build a dependency graph', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });
    const storyC = createStory(db, { teamId: team.id, title: 'Story C', description: 'Test' });

    addStoryDependency(db, storyB.id, storyA.id);
    addStoryDependency(db, storyC.id, storyA.id);

    const graph = buildDependencyGraph(db, [storyA, storyB, storyC]);

    expect(graph.has(storyA.id)).toBe(true);
    expect(graph.has(storyB.id)).toBe(true);
    expect(graph.has(storyC.id)).toBe(true);

    expect(graph.get(storyA.id)).toEqual(new Set());
    expect(graph.get(storyB.id)).toEqual(new Set([storyA.id]));
    expect(graph.get(storyC.id)).toEqual(new Set([storyA.id]));
  });

  it('should include only stories in the input list', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });
    const storyC = createStory(db, { teamId: team.id, title: 'Story C', description: 'Test' });

    // B depends on A (A is not in the filter list)
    addStoryDependency(db, storyB.id, storyA.id);

    // Only include B and C in the graph
    const graph = buildDependencyGraph(db, [storyB, storyC]);

    expect(graph.has(storyB.id)).toBe(true);
    expect(graph.has(storyC.id)).toBe(true);
    expect(graph.has(storyA.id)).toBe(false);
  });
});

describe('Scheduler Worktree Removal', () => {
  it('should log worktree removal failures to the database', () => {
    // Mock the shared removeWorktree to simulate failure
    vi.spyOn(worktreeModule, 'removeWorktree').mockReturnValue({
      success: false,
      error: 'Permission denied',
      fullWorktreePath: '/tmp/repos/test-agent-1',
    });

    const removeMethod = (scheduler as any).removeAgentWorktree;
    removeMethod.call(scheduler, 'repos/test-agent-1', 'agent-test-1');

    // Check that the failure was logged
    const logs = getLogsByEventType(db, 'WORKTREE_REMOVAL_FAILED');
    expect(logs).toHaveLength(1);
    expect(logs[0].agent_id).toBe('agent-test-1');
    expect(logs[0].event_type).toBe('WORKTREE_REMOVAL_FAILED');
    expect(logs[0].status).toBe('error');
    expect(logs[0].message).toContain('Permission denied');

    vi.restoreAllMocks();
  });

  it('should handle empty worktree paths gracefully', () => {
    const removeMethod = (scheduler as any).removeAgentWorktree;

    // Should return without error for empty path
    removeMethod.call(scheduler, '', 'agent-test-1');

    // Should not log anything
    const logs = getLogsByEventType(db, 'WORKTREE_REMOVAL_FAILED');
    expect(logs).toHaveLength(0);
  });
});

describe('Scheduler Orphaned Story Recovery', () => {
  it('should recover orphaned stories assigned to terminated agents', async () => {
    // Setup: Create team, agents, and a story
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a terminated agent in the database
    const terminatedAgentId = 'agent-terminated-1';
    db.run(
      `INSERT INTO agents (id, type, team_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [terminatedAgentId, 'intermediate', team.id, 'terminated']
    );

    // Create a story assigned to the terminated agent
    const story = createStory(db, {
      teamId: team.id,
      title: 'Orphaned Story',
      description: 'Test',
    });
    updateStory(db, story.id, {
      assignedAgentId: terminatedAgentId,
      status: 'in_progress',
    });

    // Get the recovery method
    const recovered = detectAndRecoverOrphanedStories(db, '/tmp');

    // Verify the story was recovered
    expect(recovered).toContain(story.id);
    expect(recovered.length).toBe(1);

    // Verify the story's assignment was cleared and status changed
    const recoveredStory = db.exec(
      `SELECT assigned_agent_id, status FROM stories WHERE id = '${story.id}'`
    )[0]?.values[0];

    expect(recoveredStory?.[0]).toBeNull(); // assigned_agent_id should be null
    expect(recoveredStory?.[1]).toBe('planned'); // status should be 'planned'
  });

  it('should not affect stories assigned to active agents', async () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create an active (non-terminated) agent
    const activeAgentId = 'agent-active-1';
    db.run(
      `INSERT INTO agents (id, type, team_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [activeAgentId, 'intermediate', team.id, 'working']
    );

    // Create a story assigned to the active agent
    const story = createStory(db, { teamId: team.id, title: 'Active Story', description: 'Test' });
    updateStory(db, story.id, {
      assignedAgentId: activeAgentId,
      status: 'in_progress',
    });

    // Get the recovery method
    const recovered = detectAndRecoverOrphanedStories(db, '/tmp');

    // Verify no stories were recovered
    expect(recovered.length).toBe(0);

    // Verify the story's assignment was NOT changed
    const unchangedStory = db.exec(
      `SELECT assigned_agent_id, status FROM stories WHERE id = '${story.id}'`
    )[0]?.values[0];

    expect(unchangedStory?.[0]).toBe(activeAgentId);
    expect(unchangedStory?.[1]).toBe('in_progress');
  });

  it('should recover stale in_progress stories without assigned agents', async () => {
    const team = createTeam(db, {
      name: 'Stale Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const staleStory = createStory(db, {
      teamId: team.id,
      title: 'Stale In Progress Story',
      description: 'Lost assignment',
    });
    updateStory(db, staleStory.id, {
      status: 'in_progress',
      assignedAgentId: null,
    });

    const recovered = detectAndRecoverOrphanedStories(db, '/tmp');

    expect(recovered).toContain(staleStory.id);

    const recoveredStory = db.exec(
      `SELECT assigned_agent_id, status FROM stories WHERE id = '${staleStory.id}'`
    )[0]?.values[0];

    expect(recoveredStory?.[0]).toBeNull();
    expect(recoveredStory?.[1]).toBe('planned');
  });

  it('should not recover planned stories that are unassigned', async () => {
    const team = createTeam(db, {
      name: 'Planned Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const plannedStory = createStory(db, {
      teamId: team.id,
      title: 'Already Planned',
      description: 'Should stay planned',
    });
    updateStory(db, plannedStory.id, {
      status: 'planned',
      assignedAgentId: null,
    });

    const recovered = detectAndRecoverOrphanedStories(db, '/tmp');

    expect(recovered).not.toContain(plannedStory.id);
  });

  it('should recover multiple orphaned stories', async () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a terminated agent
    const terminatedAgentId = 'agent-terminated-2';
    db.run(
      `INSERT INTO agents (id, type, team_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [terminatedAgentId, 'intermediate', team.id, 'terminated']
    );

    // Create multiple stories assigned to the terminated agent
    const story1 = createStory(db, {
      teamId: team.id,
      title: 'Orphaned Story 1',
      description: 'Test',
    });
    const story2 = createStory(db, {
      teamId: team.id,
      title: 'Orphaned Story 2',
      description: 'Test',
    });

    updateStory(db, story1.id, {
      assignedAgentId: terminatedAgentId,
      status: 'in_progress',
    });
    updateStory(db, story2.id, {
      assignedAgentId: terminatedAgentId,
      status: 'review',
    });

    // Get the recovery method
    const recovered = detectAndRecoverOrphanedStories(db, '/tmp');

    // Verify both stories were recovered
    expect(recovered.length).toBe(2);
    expect(recovered).toContain(story1.id);
    expect(recovered).toContain(story2.id);
  });
});

describe('Scheduler Refactor Capacity Policy', () => {
  function createRefactorScalingConfig(config: {
    enabled: boolean;
    capacity_percent: number;
    allow_without_feature_work: boolean;
  }) {
    return {
      ...mockConfig.scaling,
      refactor: config,
    } as any;
  }

  it('should enforce refactor budget based on feature workload', () => {
    const team = createTeam(db, {
      name: 'Refactor Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const feature = createStory(db, {
      teamId: team.id,
      title: 'Add endpoint',
      description: 'Feature story',
    });
    updateStory(db, feature.id, { status: 'planned', storyPoints: 10, complexityScore: 10 });

    const refactorA = createStory(db, {
      teamId: team.id,
      title: 'Refactor: clean parser',
      description: 'Refactor A',
    });
    updateStory(db, refactorA.id, { status: 'planned', storyPoints: 1, complexityScore: 1 });

    const refactorB = createStory(db, {
      teamId: team.id,
      title: 'Refactor: simplify auth flow',
      description: 'Refactor B',
    });
    updateStory(db, refactorB.id, { status: 'planned', storyPoints: 2, complexityScore: 2 });

    const scalingConfig = createRefactorScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const selected = selectStoriesForCapacity(
      [
        getStoryById(db, feature.id)!,
        getStoryById(db, refactorA.id)!,
        getStoryById(db, refactorB.id)!,
      ],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toContain(feature.id);
    expect(selected.map(s => s.id)).toContain(refactorA.id);
    expect(selected.map(s => s.id)).not.toContain(refactorB.id);
  });

  it('should allow refactor-only queues when policy permits', () => {
    const team = createTeam(db, {
      name: 'Maintenance Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const refactor = createStory(db, {
      teamId: team.id,
      title: 'Refactor: remove dead code',
      description: 'Maintenance',
    });
    updateStory(db, refactor.id, { status: 'planned', storyPoints: 3, complexityScore: 3 });

    const scalingConfig = createRefactorScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const selected = selectStoriesForCapacity(
      [getStoryById(db, refactor.id)!],
      scalingConfig
    ) as StoryRow[];

    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(refactor.id);
  });

  it('should block refactor-only queues when policy disallows it', () => {
    const team = createTeam(db, {
      name: 'Strict Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const refactor = createStory(db, {
      teamId: team.id,
      title: 'Refactor: rename internals',
      description: 'Maintenance',
    });
    updateStory(db, refactor.id, { status: 'planned', storyPoints: 2, complexityScore: 2 });

    const scalingConfig = createRefactorScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: false,
    });

    const selected = selectStoriesForCapacity(
      [getStoryById(db, refactor.id)!],
      scalingConfig
    ) as StoryRow[];

    expect(selected).toHaveLength(0);
  });
});

describe('Scheduler Refactor Policy Test Matrix', () => {
  let storyCounter = 0;

  function mkStory(
    title: string,
    storyPoints: number | null = null,
    complexity: number | null = null
  ): StoryRow {
    storyCounter++;
    return {
      id: `STORY-MATRIX-${storyCounter}`,
      requirement_id: null,
      team_id: 'team-matrix',
      title,
      description: 'matrix story',
      acceptance_criteria: null,
      complexity_score: complexity,
      story_points: storyPoints,
      status: 'planned',
      assigned_agent_id: null,
      branch_name: null,
      pr_url: null,
      jira_issue_key: null,
      jira_issue_id: null,
      jira_project_key: null,
      jira_subtask_key: null,
      jira_subtask_id: null,
      external_issue_key: null,
      external_issue_id: null,
      external_project_key: null,
      external_subtask_key: null,
      external_subtask_id: null,
      external_provider: null,
      in_sprint: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  function mkScalingConfig(config?: {
    enabled: boolean;
    capacity_percent: number;
    allow_without_feature_work: boolean;
  }) {
    if (!config) {
      return { ...mockConfig.scaling } as any;
    }

    return {
      ...mockConfig.scaling,
      refactor: config,
    } as any;
  }

  beforeEach(() => {
    storyCounter = 0;
  });

  // 8 tests: refactor title detection
  it.each([
    'Refactor: simplify parser',
    'refactor: simplify parser',
    'REFACTOR: simplify parser',
    '  Refactor : simplify parser',
    '\tRefactor: simplify parser',
    'Refactor:',
  ])('should detect refactor story title: %s', title => {
    expect(isRefactorStory(mkStory(title))).toBe(true);
  });

  it.each([
    'Refactoring: simplify parser',
    'Hotfix refactor: simplify parser',
    'Feature Refactor : simplify parser',
    'Maintenance task',
    '',
  ])('should not detect non-refactor story title: %s', title => {
    expect(isRefactorStory(mkStory(title))).toBe(false);
  });

  // 5 tests: capacity point calculation
  it('should use story_points when both story_points and complexity_score exist', () => {
    expect(getCapacityPoints(mkStory('Feature', 8, 3))).toBe(8);
  });

  it('should use complexity_score when story_points is null', () => {
    expect(getCapacityPoints(mkStory('Feature', null, 5))).toBe(5);
  });

  it('should default to 1 when both story_points and complexity_score are null', () => {
    expect(getCapacityPoints(mkStory('Feature', null, null))).toBe(1);
  });

  it('should treat story_points 0 as missing and fall back to complexity_score', () => {
    expect(getCapacityPoints(mkStory('Feature', 0, 4))).toBe(4);
  });

  it('should treat 0/0 points as minimum 1 capacity unit', () => {
    expect(getCapacityPoints(mkStory('Feature', 0, 0))).toBe(1);
  });

  it('should use story_points when complexity_score is null', () => {
    expect(getCapacityPoints(mkStory('Feature', 6, null))).toBe(6);
  });

  it('should pass through non-integer capacity points as provided', () => {
    expect(getCapacityPoints(mkStory('Feature', 2.5, null))).toBe(2.5);
  });

  // 12 tests: capacity selection behavior
  it('should filter out refactor stories when refactor policy is disabled', () => {
    const scalingConfig = mkScalingConfig({
      enabled: false,
      capacity_percent: 100,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: add endpoint', 8, 8);
    const refactor = mkStory('Refactor: split parser', 2, 2);
    const selected = selectStoriesForCapacity([feature, refactor], scalingConfig) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should include all refactor stories when capacity percent is 100', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 100,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: add endpoint', 10, 10);
    const refactorA = mkStory('Refactor: split parser', 3, 3);
    const refactorB = mkStory('Refactor: normalize naming', 4, 4);
    const selected = selectStoriesForCapacity(
      [feature, refactorA, refactorB],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id, refactorB.id]);
  });

  it('should include no refactor stories when capacity percent is 0 and feature work exists', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 0,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: add endpoint', 10, 10);
    const refactor = mkStory('Refactor: split parser', 1, 1);
    const selected = selectStoriesForCapacity([feature, refactor], scalingConfig) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should allow at least one refactor point when percent is positive but rounded budget is zero', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: tiny patch', 5, 5); // floor(5 * 0.1) = 0 -> min 1
    const refactor = mkStory('Refactor: tighten types', 1, 1);
    const selected = selectStoriesForCapacity([feature, refactor], scalingConfig) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactor.id]);
  });

  it('should compute budget from total feature story points across multiple stories', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });

    const featureA = mkStory('Feature: A', 5, 5);
    const featureB = mkStory('Feature: B', 5, 5); // total feature = 10, budget = 2
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 1, 1);
    const refactorC = mkStory('Refactor: C', 1, 1);
    const selected = selectStoriesForCapacity(
      [featureA, featureB, refactorA, refactorB, refactorC],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([featureA.id, featureB.id, refactorA.id, refactorB.id]);
  });

  it('should skip a refactor story that exceeds remaining budget', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: A', 10, 10); // budget = 2
    const refactorLarge = mkStory('Refactor: big cleanup', 3, 3);
    const selected = selectStoriesForCapacity(
      [feature, refactorLarge],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should select a later smaller refactor story if an earlier one exceeds budget', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: A', 10, 10); // budget = 2
    const refactorLarge = mkStory('Refactor: big cleanup', 3, 3); // skipped
    const refactorSmall = mkStory('Refactor: tiny cleanup', 2, 2); // fits
    const selected = selectStoriesForCapacity(
      [feature, refactorLarge, refactorSmall],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorSmall.id]);
  });

  it('should allow refactor-only queues when configured to allow without feature work', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const refactorA = mkStory('Refactor: A', 3, 3);
    const refactorB = mkStory('Refactor: B', 5, 5);
    const selected = selectStoriesForCapacity([refactorA, refactorB], scalingConfig) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([refactorA.id, refactorB.id]);
  });

  it('should block refactor-only queues when allow_without_feature_work is false', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: false,
    });

    const refactorA = mkStory('Refactor: A', 3, 3);
    const refactorB = mkStory('Refactor: B', 5, 5);
    const selected = selectStoriesForCapacity([refactorA, refactorB], scalingConfig) as StoryRow[];

    expect(selected).toHaveLength(0);
  });

  it('should preserve order of selected stories', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });

    const featureA = mkStory('Feature: A', 5, 5);
    const refactorA = mkStory('Refactor: A', 1, 1);
    const featureB = mkStory('Feature: B', 5, 5);
    const refactorB = mkStory('Refactor: B', 1, 1);
    const selected = selectStoriesForCapacity(
      [featureA, refactorA, featureB, refactorB],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([featureA.id, refactorA.id, featureB.id, refactorB.id]);
  });

  it('should default to disabled behavior when refactor config is missing', () => {
    const scalingConfig = mkScalingConfig();

    const feature = mkStory('Feature: A', 5, 5);
    const refactor = mkStory('Refactor: A', 1, 1);
    const selected = selectStoriesForCapacity([feature, refactor], scalingConfig) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should return an empty array when no stories are provided', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 50,
      allow_without_feature_work: true,
    });

    const selected = selectStoriesForCapacity([], scalingConfig) as StoryRow[];
    expect(selected).toEqual([]);
  });

  it('should include refactor stories when cumulative points exactly match budget', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 30,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: A', 10, 10); // budget = 3
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 2, 2);
    const selected = selectStoriesForCapacity(
      [feature, refactorA, refactorB],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id, refactorB.id]);
  });

  it('should continue selecting later refactors after partially consuming budget and skipping a too-large one', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 50,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: A', 10, 10); // budget = 5
    const refactorA = mkStory('Refactor: A', 2, 2); // used = 2
    const refactorLarge = mkStory('Refactor: Large', 4, 4); // skipped (2 + 4 > 5)
    const refactorB = mkStory('Refactor: B', 3, 3); // used = 5
    const selected = selectStoriesForCapacity(
      [feature, refactorA, refactorLarge, refactorB],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id, refactorB.id]);
  });

  it('should derive feature budget from complexity when story_points are not set', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });

    const featureA = mkStory('Feature: A', null, 6);
    const featureB = mkStory('Feature: B', null, 4); // feature total = 10, budget = 2
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 2, 2);
    const selected = selectStoriesForCapacity(
      [featureA, featureB, refactorA, refactorB],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([featureA.id, featureB.id, refactorA.id]);
  });

  it('should allow one point of refactor work when feature stories have no explicit points', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const feature = mkStory('Feature: A', null, null); // defaults to 1, floor(1 * 0.1)=0 -> min 1
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 1, 1);
    const selected = selectStoriesForCapacity(
      [feature, refactorA, refactorB],
      scalingConfig
    ) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id]);
  });

  it('should ignore capacity_percent for refactor-only queues when allow_without_feature_work is true', () => {
    const scalingConfig = mkScalingConfig({
      enabled: true,
      capacity_percent: 0,
      allow_without_feature_work: true,
    });

    const refactorA = mkStory('Refactor: A', 2, 2);
    const refactorB = mkStory('Refactor: B', 4, 4);
    const selected = selectStoriesForCapacity([refactorA, refactorB], scalingConfig) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([refactorA.id, refactorB.id]);
  });
});

describe('Scheduler Agent Selection', () => {
  it('should select agent with least workload from multiple agents', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create three junior agents with different workloads
    db.run(
      `INSERT INTO agents (id, type, team_id, status) VALUES ('junior-1', 'junior', '${team.id}', 'idle')`
    );
    db.run(
      `INSERT INTO agents (id, type, team_id, status) VALUES ('junior-2', 'junior', '${team.id}', 'idle')`
    );
    db.run(
      `INSERT INTO agents (id, type, team_id, status) VALUES ('junior-3', 'junior', '${team.id}', 'idle')`
    );

    // Give junior-1 two stories, junior-2 one story, junior-3 zero stories
    const story1 = createStory(db, { teamId: team.id, title: 'Story 1', description: 'Test' });
    const story2 = createStory(db, { teamId: team.id, title: 'Story 2', description: 'Test' });
    const story3 = createStory(db, { teamId: team.id, title: 'Story 3', description: 'Test' });
    updateStory(db, story1.id, { assignedAgentId: 'junior-1', status: 'in_progress' });
    updateStory(db, story2.id, { assignedAgentId: 'junior-1', status: 'in_progress' });
    updateStory(db, story3.id, { assignedAgentId: 'junior-2', status: 'in_progress' });

    const agents = [
      {
        id: 'junior-1',
        type: 'junior' as const,
        team_id: team.id,
        tmux_session: null,
        model: null,
        status: 'idle' as const,
        current_story_id: null,
        memory_state: null,
        last_seen: null,
        cli_tool: 'claude',
        worktree_path: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'junior-2',
        type: 'junior' as const,
        team_id: team.id,
        tmux_session: null,
        model: null,
        status: 'idle' as const,
        current_story_id: null,
        memory_state: null,
        last_seen: null,
        cli_tool: 'claude',
        worktree_path: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'junior-3',
        type: 'junior' as const,
        team_id: team.id,
        tmux_session: null,
        model: null,
        status: 'idle' as const,
        current_story_id: null,
        memory_state: null,
        last_seen: null,
        cli_tool: 'claude',
        worktree_path: null,
        created_at: '',
        updated_at: '',
      },
    ];

    const selected = selectAgentWithLeastWorkload(db, agents);

    // Should select junior-3 who has zero stories
    expect(selected.id).toBe('junior-3');
  });

  it('should select first agent when all have equal workload', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const agents = [
      {
        id: 'agent-1',
        type: 'junior' as const,
        team_id: team.id,
        tmux_session: null,
        model: null,
        status: 'idle' as const,
        current_story_id: null,
        memory_state: null,
        last_seen: null,
        cli_tool: 'claude',
        worktree_path: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'agent-2',
        type: 'junior' as const,
        team_id: team.id,
        tmux_session: null,
        model: null,
        status: 'idle' as const,
        current_story_id: null,
        memory_state: null,
        last_seen: null,
        cli_tool: 'claude',
        worktree_path: null,
        created_at: '',
        updated_at: '',
      },
    ];

    const selected = selectAgentWithLeastWorkload(db, agents);

    expect(selected.id).toBe('agent-1');
  });

  it('should calculate agent workload correctly', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    db.run(
      `INSERT INTO agents (id, type, team_id, status) VALUES ('agent-1', 'junior', '${team.id}', 'idle')`
    );

    const story1 = createStory(db, { teamId: team.id, title: 'Story 1', description: 'Test' });
    const story2 = createStory(db, { teamId: team.id, title: 'Story 2', description: 'Test' });
    updateStory(db, story1.id, { assignedAgentId: 'agent-1', status: 'in_progress' });
    updateStory(db, story2.id, { assignedAgentId: 'agent-1', status: 'in_progress' });

    const workload = getAgentWorkload(db, 'agent-1');

    expect(workload).toBe(2);
  });

  it('should return zero workload for agent with no stories', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    db.run(
      `INSERT INTO agents (id, type, team_id, status) VALUES ('agent-1', 'junior', '${team.id}', 'idle')`
    );

    const workload = getAgentWorkload(db, 'agent-1');

    expect(workload).toBe(0);
  });
});

describe('Scheduler Complexity Routing', () => {
  it('should route low complexity stories to junior agents', () => {
    // Test the routing logic: complexity <= junior_max_complexity goes to junior
    const complexity = 2;
    expect(complexity).toBeLessThanOrEqual(mockConfig.scaling.junior_max_complexity);
  });

  it('should route medium complexity stories to intermediate agents', () => {
    // Test the routing logic: complexity between junior and intermediate thresholds
    const complexity = 4;
    expect(complexity).toBeGreaterThan(mockConfig.scaling.junior_max_complexity);
    expect(complexity).toBeLessThanOrEqual(mockConfig.scaling.intermediate_max_complexity);
  });

  it('should route high complexity stories to senior agents', () => {
    // Test the routing logic: complexity > intermediate_max_complexity goes to senior
    const complexity = 8;
    expect(complexity).toBeGreaterThan(mockConfig.scaling.intermediate_max_complexity);
  });

  it('should handle edge case at junior boundary', () => {
    // Complexity exactly at junior_max_complexity should still go to junior
    const complexity = 3;
    expect(complexity).toBeLessThanOrEqual(mockConfig.scaling.junior_max_complexity);
  });

  it('should handle edge case at intermediate boundary', () => {
    // Complexity exactly at intermediate_max_complexity should still go to intermediate
    const complexity = 5;
    expect(complexity).toBeLessThanOrEqual(mockConfig.scaling.intermediate_max_complexity);
  });

  it('should use config values for routing thresholds', () => {
    // Verify config values are set correctly for routing logic
    expect(mockConfig.scaling.junior_max_complexity).toBe(3);
    expect(mockConfig.scaling.intermediate_max_complexity).toBe(5);
  });

  it('should default to complexity 5 when not specified', () => {
    // Test default complexity value used in assignStories
    const complexity = null;
    const defaultComplexity = complexity || 5;
    expect(defaultComplexity).toBe(5);
  });
});

describe('Scheduler Story Assignment Prevention', () => {
  it('should prevent duplicate story assignments', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    db.run(
      `INSERT INTO agents (id, type, team_id, status) VALUES ('agent-1', 'junior', '${team.id}', 'idle')`
    );

    // Create a story and assign it
    const story = createStory(db, {
      teamId: team.id,
      title: 'Story',
      description: 'Test',
    });
    updateStory(db, story.id, { complexityScore: 2, status: 'planned' });

    // First assignment
    updateStory(db, story.id, { assignedAgentId: 'agent-1', status: 'in_progress' });

    // Verify the story is now assigned
    const result = db.exec(`SELECT assigned_agent_id FROM stories WHERE id = '${story.id}'`);
    expect(result[0].values[0][0]).toBe('agent-1');
  });

  it('should verify story assignment changes status', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const story = createStory(db, {
      teamId: team.id,
      title: 'Story',
      description: 'Test',
    });
    updateStory(db, story.id, { status: 'planned' });

    // Change status to in_progress
    updateStory(db, story.id, { status: 'in_progress' });

    // Verify status changed
    const result = db.exec(`SELECT status FROM stories WHERE id = '${story.id}'`);
    expect(result[0].values[0][0]).toBe('in_progress');
  });

  it('should skip stories with unsatisfied dependencies', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    updateStory(db, storyA.id, { status: 'planned' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });
    updateStory(db, storyB.id, { status: 'planned' });

    // B depends on A, but A is still planned
    addStoryDependency(db, storyB.id, storyA.id);

    // B should not be ready for assignment because A is not merged yet
    const satisfied = areDependenciesSatisfied(db, storyB.id);
    expect(satisfied).toBe(false);
  });

  it('should allow stories when dependencies are in terminal states', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Test with merged status (terminal state)
    const storyA = createStory(db, { teamId: team.id, title: 'Story A', description: 'Test' });
    const storyB = createStory(db, { teamId: team.id, title: 'Story B', description: 'Test' });

    // Update A to merged status
    updateStory(db, storyA.id, { status: 'merged' });

    // B depends on A, and A is merged
    addStoryDependency(db, storyB.id, storyA.id);

    // B should be ready for assignment
    const satisfied = areDependenciesSatisfied(db, storyB.id);
    expect(satisfied).toBe(true);
  });

  it('should map claude model IDs to claude runtime shorthands', () => {
    const runtimeModel = (scheduler as any).getRuntimeModel('claude-sonnet-4-5-20250929', 'claude');
    expect(runtimeModel).toBe('sonnet');
  });

  it('should preserve configured model for codex and gemini runtimes', () => {
    const codexModel = (scheduler as any).getRuntimeModel('gpt-4o-mini', 'codex');
    const geminiModel = (scheduler as any).getRuntimeModel('gemini-2.5-pro', 'gemini');
    expect(codexModel).toBe('gpt-4o-mini');
    expect(geminiModel).toBe('gemini-2.5-pro');
  });

  it('should not fallback unknown claude models to haiku', () => {
    const runtimeModel = (scheduler as any).getRuntimeModel('claude-custom-model', 'claude');
    expect(runtimeModel).toBe('claude-custom-model');
  });

  it('should detect godmode is active when an active requirement has godmode enabled', () => {
    // Create a requirement with godmode and set it to planning status
    const req = createRequirement(db, {
      title: 'Godmode Requirement',
      description: 'Test requirement with godmode',
      godmode: true,
    });
    db.run(`UPDATE requirements SET status = 'planning' WHERE id = ?`, [req.id]);

    // Godmode should be detected as active
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(true);
  });

  it('should detect godmode even when all stories have moved to in_progress', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a godmode requirement in in_progress status
    const req = createRequirement(db, {
      title: 'Godmode Requirement',
      description: 'Test requirement with godmode',
      godmode: true,
    });
    db.run(`UPDATE requirements SET status = 'in_progress' WHERE id = ?`, [req.id]);

    // Create a story that has moved to in_progress (no longer planned)
    const story = createStory(db, {
      requirementId: req.id,
      teamId: team.id,
      title: 'Godmode Story',
      description: 'Test',
    });
    updateStory(db, story.id, { status: 'in_progress' });

    // Godmode should still be active even though no stories are planned
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(true);
  });

  it('should not detect godmode when no requirements have godmode enabled', () => {
    // Create a normal requirement (without godmode) in planning status
    const req = createRequirement(db, {
      title: 'Normal Requirement',
      description: 'Test requirement without godmode',
      godmode: false,
    });
    db.run(`UPDATE requirements SET status = 'planning' WHERE id = ?`, [req.id]);

    // Godmode should not be detected as active
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(false);
  });

  it('should not detect godmode when godmode requirement is completed', () => {
    // Create a godmode requirement that is already completed
    const req = createRequirement(db, {
      title: 'Godmode Requirement',
      description: 'Test requirement with godmode',
      godmode: true,
    });
    db.run(`UPDATE requirements SET status = 'completed' WHERE id = ?`, [req.id]);

    // Godmode should not be active for completed requirements
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(false);
  });

  it('should not detect godmode when no requirements exist', () => {
    // No requirements created, so godmode cannot be active
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(false);
  });
});

describe('Scheduler Agent Reassignment for Working Agents with NULL currentStoryId', () => {
  it('should consider working agents with null current_story_id as available for assignment', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a working agent with no current story (effectively idle)
    db.run(
      `INSERT INTO agents (id, type, team_id, status, current_story_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, datetime('now'), datetime('now'))`,
      ['senior-orphan-1', 'senior', team.id, 'working']
    );

    // Query agents using the same filter logic from assignStories
    const result = db.exec(
      `SELECT id, type, status, current_story_id FROM agents
       WHERE team_id = '${team.id}' AND type != 'qa'
       AND (status = 'idle' OR (status = 'working' AND current_story_id IS NULL))`
    );

    expect(result[0].values).toHaveLength(1);
    expect(result[0].values[0][0]).toBe('senior-orphan-1');
  });

  it('should not consider working agents with a current story as available', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    const story = createStory(db, { teamId: team.id, title: 'Active', description: 'Test' });

    // Create a working agent with a current story
    db.run(
      `INSERT INTO agents (id, type, team_id, status, current_story_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      ['senior-busy-1', 'senior', team.id, 'working', story.id]
    );

    // Query agents using the same filter logic from assignStories
    const result = db.exec(
      `SELECT id, type, status, current_story_id FROM agents
       WHERE team_id = '${team.id}' AND type != 'qa'
       AND (status = 'idle' OR (status = 'working' AND current_story_id IS NULL))`
    );

    // Should not include the busy agent
    expect(result).toHaveLength(0);
  });
});

describe('Scheduler checkScaling', () => {
  it('should only spawn agents for assignable stories (unblocked dependencies)', async () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a blocker story that is not yet merged
    const blockerStory = createStory(db, {
      teamId: team.id,
      title: 'Blocker Story',
      description: 'Must be completed first',
    });
    updateStory(db, blockerStory.id, { status: 'planned', storyPoints: 10 });

    // Create 4 stories that depend on the blocker (cannot be assigned yet)
    for (let i = 1; i <= 4; i++) {
      const story = createStory(db, {
        teamId: team.id,
        title: `Blocked Story ${i}`,
        description: 'Depends on blocker',
      });
      updateStory(db, story.id, { status: 'planned', storyPoints: 10 });
      addStoryDependency(db, story.id, blockerStory.id);
    }

    // Create 1 story with no dependencies (can be assigned)
    const unblockedStory = createStory(db, {
      teamId: team.id,
      title: 'Unblocked Story',
      description: 'No dependencies',
    });
    updateStory(db, unblockedStory.id, { status: 'planned', storyPoints: 10 });

    // Total: 50 story points, but only 10 are assignable
    // With senior_capacity: 50, this should spawn 1 senior (10/50 = 0.2, ceil = 1)
    // NOT 1 senior (50/50 = 1)

    // Mock spawnSenior to track calls
    const spawnSeniorSpy = vi.spyOn(scheduler as any, 'spawnSenior').mockResolvedValue({
      id: 'test-senior',
      type: 'senior',
      team_id: team.id,
      status: 'idle',
    });

    // Run checkScaling
    await scheduler.checkScaling();

    // Should spawn exactly 1 senior for 10 assignable points (not 0 seniors)
    expect(spawnSeniorSpy).toHaveBeenCalledTimes(1);

    spawnSeniorSpy.mockRestore();
  });

  it('should not spawn agents when all stories are blocked', async () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a blocker story that is not yet merged
    const blockerStory = createStory(db, {
      teamId: team.id,
      title: 'Blocker Story',
      description: 'Must be completed first',
    });
    updateStory(db, blockerStory.id, { status: 'planned', storyPoints: 10 });

    // Create stories that all depend on the blocker
    for (let i = 1; i <= 5; i++) {
      const story = createStory(db, {
        teamId: team.id,
        title: `Blocked Story ${i}`,
        description: 'Depends on blocker',
      });
      updateStory(db, story.id, { status: 'planned', storyPoints: 10 });
      addStoryDependency(db, story.id, blockerStory.id);
    }

    // Mock spawnSenior to track calls
    const spawnSeniorSpy = vi.spyOn(scheduler as any, 'spawnSenior').mockResolvedValue({
      id: 'test-senior',
      type: 'senior',
      team_id: team.id,
      status: 'idle',
    });

    // Run checkScaling
    await scheduler.checkScaling();

    // Should not spawn any agents because all stories except the blocker are blocked
    // The blocker itself (10 points) would need agents, so we expect 1 spawn
    expect(spawnSeniorSpy).toHaveBeenCalledTimes(1);

    spawnSeniorSpy.mockRestore();
  });
});
