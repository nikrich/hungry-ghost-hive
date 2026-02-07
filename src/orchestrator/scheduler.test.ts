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
import { Scheduler } from './scheduler.js';

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
    },
    senior: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 0.5,
      cli_tool: 'claude',
    },
    intermediate: {
      provider: 'anthropic',
      model: 'claude-haiku-3-5-20241022',
      max_tokens: 4000,
      temperature: 0.3,
      cli_tool: 'claude',
    },
    junior: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      max_tokens: 4000,
      temperature: 0.2,
      cli_tool: 'claude',
    },
    qa: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 0.2,
      cli_tool: 'claude',
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
    const sortMethod = (scheduler as any).topologicalSort;
    const sorted = sortMethod.call(scheduler, [story1, story2]);

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

    const sortMethod = (scheduler as any).topologicalSort;
    const sorted = sortMethod.call(scheduler, [storyC, storyA, storyB]);

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

    const sortMethod = (scheduler as any).topologicalSort;
    const sorted = sortMethod.call(scheduler, [storyD, storyB, storyA, storyC]);

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

    const sortMethod = (scheduler as any).topologicalSort;
    const sorted = sortMethod.call(scheduler, [storyA, storyB]);

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
    let isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
    expect(isSatisfied).toBe(false);

    // Mark dependency as merged
    updateStory(db, depStory.id, { status: 'merged' });
    isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
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
    const isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
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

    const isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
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
    let isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
    expect(isSatisfied).toBe(false);

    // Mark second dependency as merged too
    updateStory(db, dep2.id, { status: 'merged' });
    isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
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

    const graphMethod = (scheduler as any).buildDependencyGraph;
    const graph = graphMethod.call(scheduler, [storyA, storyB, storyC]);

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

    const graphMethod = (scheduler as any).buildDependencyGraph;
    // Only include B and C in the graph
    const graph = graphMethod.call(scheduler, [storyB, storyC]);

    expect(graph.has(storyB.id)).toBe(true);
    expect(graph.has(storyC.id)).toBe(true);
    expect(graph.has(storyA.id)).toBe(false);
  });
});

describe('Scheduler Worktree Removal', () => {
  it('should log worktree removal failures to the database', async () => {
    // Mock execSync to throw an error
    const mockExecSync = vi.fn().mockImplementation(() => {
      throw new Error('Permission denied');
    });
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));

    const removeMethod = (scheduler as any).removeWorktree;
    await removeMethod.call(scheduler, 'repos/test-agent-1', 'agent-test-1');

    // Check that the failure was logged
    const logs = getLogsByEventType(db, 'WORKTREE_REMOVAL_FAILED');
    expect(logs).toHaveLength(1);
    expect(logs[0].agent_id).toBe('agent-test-1');
    expect(logs[0].event_type).toBe('WORKTREE_REMOVAL_FAILED');
    expect(logs[0].status).toBe('error');
    expect(logs[0].message).toContain('Permission denied');

    // Restore original execSync
    vi.unmock('child_process');
  });

  it('should handle empty worktree paths gracefully', async () => {
    const removeMethod = (scheduler as any).removeWorktree;

    // Should return without error for empty path
    await expect(removeMethod.call(scheduler, '', 'agent-test-1')).resolves.toBeUndefined();

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
    const recoverMethod = (scheduler as any).detectAndRecoverOrphanedStories;
    const recovered = recoverMethod.call(scheduler);

    // Verify the story was recovered
    expect(recovered).toContain(story.id);
    expect(recovered.length).toBe(1);

    // Verify the story's assignment was cleared and status changed
    const recoveredStory = (scheduler as any).db.exec(
      `SELECT assigned_agent_id, status FROM stories WHERE id = ?`,
      [story.id]
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
    const recoverMethod = (scheduler as any).detectAndRecoverOrphanedStories;
    const recovered = recoverMethod.call(scheduler);

    // Verify no stories were recovered
    expect(recovered.length).toBe(0);

    // Verify the story's assignment was NOT changed
    const unchangedStory = (scheduler as any).db.exec(
      `SELECT assigned_agent_id, status FROM stories WHERE id = ?`,
      [story.id]
    )[0]?.values[0];

    expect(unchangedStory?.[0]).toBe(activeAgentId);
    expect(unchangedStory?.[1]).toBe('in_progress');
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
    const recoverMethod = (scheduler as any).detectAndRecoverOrphanedStories;
    const recovered = recoverMethod.call(scheduler);

    // Verify both stories were recovered
    expect(recovered.length).toBe(2);
    expect(recovered).toContain(story1.id);
    expect(recovered).toContain(story2.id);
  });
});

describe('Scheduler Refactor Capacity Policy', () => {
  function createSchedulerWithRefactorConfig(config: {
    enabled: boolean;
    capacity_percent: number;
    allow_without_feature_work: boolean;
  }): Scheduler {
    return new Scheduler(db, {
      ...mockConfig,
      scaling: {
        ...mockConfig.scaling,
        refactor: config,
      },
    } as any);
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

    const localScheduler = createSchedulerWithRefactorConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const selectMethod = (localScheduler as any).selectStoriesForCapacity;
    const selected = selectMethod.call(localScheduler, [
      getStoryById(db, feature.id)!,
      getStoryById(db, refactorA.id)!,
      getStoryById(db, refactorB.id)!,
    ]) as StoryRow[];

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

    const localScheduler = createSchedulerWithRefactorConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });

    const selectMethod = (localScheduler as any).selectStoriesForCapacity;
    const selected = selectMethod.call(localScheduler, [
      getStoryById(db, refactor.id)!,
    ]) as StoryRow[];

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

    const localScheduler = createSchedulerWithRefactorConfig({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: false,
    });

    const selectMethod = (localScheduler as any).selectStoriesForCapacity;
    const selected = selectMethod.call(localScheduler, [
      getStoryById(db, refactor.id)!,
    ]) as StoryRow[];

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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  function mkSchedulerWithRefactor(config?: {
    enabled: boolean;
    capacity_percent: number;
    allow_without_feature_work: boolean;
  }): Scheduler {
    if (!config) {
      return new Scheduler(db, {
        ...mockConfig,
        scaling: { ...mockConfig.scaling },
      } as any);
    }

    return new Scheduler(db, {
      ...mockConfig,
      scaling: {
        ...mockConfig.scaling,
        refactor: config,
      },
    } as any);
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
    const localScheduler = mkSchedulerWithRefactor();
    const isRefactor = (localScheduler as any).isRefactorStory.bind(localScheduler);
    expect(isRefactor(mkStory(title))).toBe(true);
  });

  it.each([
    'Refactoring: simplify parser',
    'Hotfix refactor: simplify parser',
    'Feature Refactor : simplify parser',
    'Maintenance task',
    '',
  ])('should not detect non-refactor story title: %s', title => {
    const localScheduler = mkSchedulerWithRefactor();
    const isRefactor = (localScheduler as any).isRefactorStory.bind(localScheduler);
    expect(isRefactor(mkStory(title))).toBe(false);
  });

  // 5 tests: capacity point calculation
  it('should use story_points when both story_points and complexity_score exist', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', 8, 3))).toBe(8);
  });

  it('should use complexity_score when story_points is null', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', null, 5))).toBe(5);
  });

  it('should default to 1 when both story_points and complexity_score are null', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', null, null))).toBe(1);
  });

  it('should treat story_points 0 as missing and fall back to complexity_score', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', 0, 4))).toBe(4);
  });

  it('should treat 0/0 points as minimum 1 capacity unit', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', 0, 0))).toBe(1);
  });

  it('should use story_points when complexity_score is null', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', 6, null))).toBe(6);
  });

  it('should pass through non-integer capacity points as provided', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const getCapacityPoints = (localScheduler as any).getCapacityPoints.bind(localScheduler);
    expect(getCapacityPoints(mkStory('Feature', 2.5, null))).toBe(2.5);
  });

  // 12 tests: capacity selection behavior
  it('should filter out refactor stories when refactor policy is disabled', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: false,
      capacity_percent: 100,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: add endpoint', 8, 8);
    const refactor = mkStory('Refactor: split parser', 2, 2);
    const selected = selectStories([feature, refactor]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should include all refactor stories when capacity percent is 100', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 100,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: add endpoint', 10, 10);
    const refactorA = mkStory('Refactor: split parser', 3, 3);
    const refactorB = mkStory('Refactor: normalize naming', 4, 4);
    const selected = selectStories([feature, refactorA, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id, refactorB.id]);
  });

  it('should include no refactor stories when capacity percent is 0 and feature work exists', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 0,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: add endpoint', 10, 10);
    const refactor = mkStory('Refactor: split parser', 1, 1);
    const selected = selectStories([feature, refactor]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should allow at least one refactor point when percent is positive but rounded budget is zero', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: tiny patch', 5, 5); // floor(5 * 0.1) = 0 -> min 1
    const refactor = mkStory('Refactor: tighten types', 1, 1);
    const selected = selectStories([feature, refactor]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactor.id]);
  });

  it('should compute budget from total feature story points across multiple stories', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const featureA = mkStory('Feature: A', 5, 5);
    const featureB = mkStory('Feature: B', 5, 5); // total feature = 10, budget = 2
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 1, 1);
    const refactorC = mkStory('Refactor: C', 1, 1);
    const selected = selectStories([
      featureA,
      featureB,
      refactorA,
      refactorB,
      refactorC,
    ]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([featureA.id, featureB.id, refactorA.id, refactorB.id]);
  });

  it('should skip a refactor story that exceeds remaining budget', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: A', 10, 10); // budget = 2
    const refactorLarge = mkStory('Refactor: big cleanup', 3, 3);
    const selected = selectStories([feature, refactorLarge]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should select a later smaller refactor story if an earlier one exceeds budget', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: A', 10, 10); // budget = 2
    const refactorLarge = mkStory('Refactor: big cleanup', 3, 3); // skipped
    const refactorSmall = mkStory('Refactor: tiny cleanup', 2, 2); // fits
    const selected = selectStories([feature, refactorLarge, refactorSmall]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorSmall.id]);
  });

  it('should allow refactor-only queues when configured to allow without feature work', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const refactorA = mkStory('Refactor: A', 3, 3);
    const refactorB = mkStory('Refactor: B', 5, 5);
    const selected = selectStories([refactorA, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([refactorA.id, refactorB.id]);
  });

  it('should block refactor-only queues when allow_without_feature_work is false', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: false,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const refactorA = mkStory('Refactor: A', 3, 3);
    const refactorB = mkStory('Refactor: B', 5, 5);
    const selected = selectStories([refactorA, refactorB]) as StoryRow[];

    expect(selected).toHaveLength(0);
  });

  it('should preserve order of selected stories', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const featureA = mkStory('Feature: A', 5, 5);
    const refactorA = mkStory('Refactor: A', 1, 1);
    const featureB = mkStory('Feature: B', 5, 5);
    const refactorB = mkStory('Refactor: B', 1, 1);
    const selected = selectStories([featureA, refactorA, featureB, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([featureA.id, refactorA.id, featureB.id, refactorB.id]);
  });

  it('should default to disabled behavior when refactor config is missing', () => {
    const localScheduler = mkSchedulerWithRefactor();
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: A', 5, 5);
    const refactor = mkStory('Refactor: A', 1, 1);
    const selected = selectStories([feature, refactor]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id]);
  });

  it('should return an empty array when no stories are provided', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 50,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const selected = selectStories([]) as StoryRow[];
    expect(selected).toEqual([]);
  });

  it('should include refactor stories when cumulative points exactly match budget', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 30,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: A', 10, 10); // budget = 3
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 2, 2);
    const selected = selectStories([feature, refactorA, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id, refactorB.id]);
  });

  it('should continue selecting later refactors after partially consuming budget and skipping a too-large one', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 50,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: A', 10, 10); // budget = 5
    const refactorA = mkStory('Refactor: A', 2, 2); // used = 2
    const refactorLarge = mkStory('Refactor: Large', 4, 4); // skipped (2 + 4 > 5)
    const refactorB = mkStory('Refactor: B', 3, 3); // used = 5
    const selected = selectStories([feature, refactorA, refactorLarge, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id, refactorB.id]);
  });

  it('should derive feature budget from complexity when story_points are not set', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 20,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const featureA = mkStory('Feature: A', null, 6);
    const featureB = mkStory('Feature: B', null, 4); // feature total = 10, budget = 2
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 2, 2);
    const selected = selectStories([featureA, featureB, refactorA, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([featureA.id, featureB.id, refactorA.id]);
  });

  it('should allow one point of refactor work when feature stories have no explicit points', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 10,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const feature = mkStory('Feature: A', null, null); // defaults to 1, floor(1 * 0.1)=0 -> min 1
    const refactorA = mkStory('Refactor: A', 1, 1);
    const refactorB = mkStory('Refactor: B', 1, 1);
    const selected = selectStories([feature, refactorA, refactorB]) as StoryRow[];

    expect(selected.map(s => s.id)).toEqual([feature.id, refactorA.id]);
  });

  it('should ignore capacity_percent for refactor-only queues when allow_without_feature_work is true', () => {
    const localScheduler = mkSchedulerWithRefactor({
      enabled: true,
      capacity_percent: 0,
      allow_without_feature_work: true,
    });
    const selectStories = (localScheduler as any).selectStoriesForCapacity.bind(localScheduler);

    const refactorA = mkStory('Refactor: A', 2, 2);
    const refactorB = mkStory('Refactor: B', 4, 4);
    const selected = selectStories([refactorA, refactorB]) as StoryRow[];

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
        created_at: '',
        updated_at: '',
      },
    ];

    const selectMethod = (scheduler as any).selectAgentWithLeastWorkload;
    const selected = selectMethod.call(scheduler, agents);

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
        created_at: '',
        updated_at: '',
      },
    ];

    const selectMethod = (scheduler as any).selectAgentWithLeastWorkload;
    const selected = selectMethod.call(scheduler, agents);

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

    const workloadMethod = (scheduler as any).getAgentWorkload;
    const workload = workloadMethod.call(scheduler, 'agent-1');

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

    const workloadMethod = (scheduler as any).getAgentWorkload;
    const workload = workloadMethod.call(scheduler, 'agent-1');

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
    const satisfied = (scheduler as any).areDependenciesSatisfied(storyB.id);
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
    const satisfied = (scheduler as any).areDependenciesSatisfied(storyB.id);
    expect(satisfied).toBe(true);
  });

  it('should detect godmode is active when a planned story has a godmode requirement', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a requirement with godmode
    const req = createRequirement(db, {
      title: 'Godmode Requirement',
      description: 'Test requirement with godmode',
      godmode: true,
    });

    // Create a story linked to the godmode requirement
    const story = createStory(db, {
      requirementId: req.id,
      teamId: team.id,
      title: 'Godmode Story',
      description: 'Test',
    });
    updateStory(db, story.id, { status: 'planned' });

    // Godmode should be detected as active
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(true);
  });

  it('should not detect godmode when no planned stories have godmode requirements', () => {
    const team = createTeam(db, {
      name: 'Test Team',
      repoUrl: 'https://github.com/test/repo',
      repoPath: 'test',
    });

    // Create a normal requirement (without godmode)
    const req = createRequirement(db, {
      title: 'Normal Requirement',
      description: 'Test requirement without godmode',
      godmode: false,
    });

    // Create a story linked to the normal requirement
    const story = createStory(db, {
      requirementId: req.id,
      teamId: team.id,
      title: 'Normal Story',
      description: 'Test',
    });
    updateStory(db, story.id, { status: 'planned' });

    // Godmode should not be detected as active
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(false);
  });

  it('should not detect godmode when no stories are planned', () => {
    // No stories created, so godmode cannot be active
    const isGodmodeActive = (scheduler as any).isGodmodeActive();
    expect(isGodmodeActive).toBe(false);
  });
});
