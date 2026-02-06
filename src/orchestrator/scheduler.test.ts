import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { Scheduler } from './scheduler.js';
import { createStory, addStoryDependency, updateStory } from '../db/queries/stories.js';
import { createTeam } from '../db/queries/teams.js';
import type { StoryRow } from '../db/queries/stories.js';

let db: Database;
let scheduler: Scheduler;

const mockConfig = {
  scaling: {
    junior_max_complexity: 3,
    intermediate_max_complexity: 5,
    senior_capacity: 50,
  },
  models: {
    tech_lead: { provider: 'anthropic', model: 'claude-opus-4-20250514', max_tokens: 16000, temperature: 0.7, cli_tool: 'claude' },
    senior: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', max_tokens: 8000, temperature: 0.5, cli_tool: 'claude' },
    intermediate: { provider: 'anthropic', model: 'claude-haiku-3-5-20241022', max_tokens: 4000, temperature: 0.3, cli_tool: 'claude' },
    junior: { provider: 'openai', model: 'gpt-4o-mini', max_tokens: 4000, temperature: 0.2, cli_tool: 'claude' },
    qa: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', max_tokens: 8000, temperature: 0.2, cli_tool: 'claude' },
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
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
    const story1 = createStory(db, { teamId: team.id, title: 'Story 1', description: 'Test' });
    const story2 = createStory(db, { teamId: team.id, title: 'Story 2', description: 'Test' });

    // Mock the private method by accessing it through reflection
    const sortMethod = (scheduler as any).topologicalSort;
    const sorted = sortMethod.call(scheduler, [story1, story2]);

    expect(sorted).not.toBeNull();
    expect(sorted).toHaveLength(2);
  });

  it('should respect linear dependencies (A -> B -> C)', () => {
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
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
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
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
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
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
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
    const depStory = createStory(db, { teamId: team.id, title: 'Dependency', description: 'Test' });
    const mainStory = createStory(db, { teamId: team.id, title: 'Main Story', description: 'Test' });

    addStoryDependency(db, mainStory.id, depStory.id);

    // Initially, dependencies are not satisfied
    let isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
    expect(isSatisfied).toBe(false);

    // Mark dependency as merged
    updateStory(db, depStory.id, { status: 'merged' });
    isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
    expect(isSatisfied).toBe(true);
  });

  it('should consider in-progress stories as satisfying dependencies', () => {
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
    const depStory = createStory(db, { teamId: team.id, title: 'Dependency', description: 'Test' });
    const mainStory = createStory(db, { teamId: team.id, title: 'Main Story', description: 'Test' });

    addStoryDependency(db, mainStory.id, depStory.id);

    // Mark dependency as in_progress
    updateStory(db, depStory.id, { status: 'in_progress' });
    const isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
    expect(isSatisfied).toBe(true);
  });

  it('should not consider planned stories as satisfying dependencies', () => {
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
    const depStory = createStory(db, { teamId: team.id, title: 'Dependency', description: 'Test' });
    const mainStory = createStory(db, { teamId: team.id, title: 'Main Story', description: 'Test' });

    addStoryDependency(db, mainStory.id, depStory.id);

    // Update main story status to planned (default)
    updateStory(db, mainStory.id, { status: 'planned' });

    const isSatisfied = (scheduler as any).areDependenciesSatisfied.call(scheduler, mainStory.id);
    expect(isSatisfied).toBe(false);
  });

  it('should handle multiple dependencies', () => {
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
    const dep1 = createStory(db, { teamId: team.id, title: 'Dep 1', description: 'Test' });
    const dep2 = createStory(db, { teamId: team.id, title: 'Dep 2', description: 'Test' });
    const mainStory = createStory(db, { teamId: team.id, title: 'Main Story', description: 'Test' });

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
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
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
    const team = createTeam(db, { name: 'Test Team', repoUrl: 'https://github.com/test/repo', repoPath: 'test' });
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
