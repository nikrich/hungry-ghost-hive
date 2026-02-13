// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryAll, queryOne } from '../db/client.js';
import type { AgentRow } from '../db/queries/agents.js';
import type { CompletionOptions, CompletionResult, LLMProvider, Message } from '../llm/provider.js';
import { TechLeadAgent, type TechLeadContext } from './tech-lead.js';

// Mock LLM Provider
class MockLLMProvider implements LLMProvider {
  name = 'mock-provider';
  private responseQueue: string[] = [];

  setNextResponse(response: string) {
    this.responseQueue.push(response);
  }

  async complete(_messages: Message[], _options?: CompletionOptions): Promise<CompletionResult> {
    const content = this.responseQueue.shift() || 'Mock response';
    return {
      content,
      stopReason: 'end_turn',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    };
  }
}

// Database schema for testing
const TEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_url TEXT,
    repo_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    team_id TEXT,
    tmux_session TEXT,
    status TEXT DEFAULT 'idle',
    memory_state TEXT,
    last_seen TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    story_id TEXT,
    event_type TEXT NOT NULL,
    message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    godmode INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    requirement_id TEXT,
    team_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    complexity_score INTEGER,
    story_points INTEGER,
    status TEXT DEFAULT 'draft',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS story_dependencies (
    story_id TEXT,
    depends_on_id TEXT,
    PRIMARY KEY (story_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT
);

CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    story_id TEXT,
    from_agent_id TEXT,
    to_agent_id TEXT,
    reason TEXT NOT NULL
);
`;

// Mock external modules
vi.mock('../tmux/manager.js', () => ({
  generateSessionName: vi.fn(() => 'test-session'),
  spawnTmuxSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/index.js', () => ({
  loadConfig: vi.fn(() => ({
    models: {
      senior: {
        cli_tool: 'claude-code',
        safety_mode: 'interactive',
        model: 'claude-sonnet-4-5',
      },
    },
    integrations: {
      project_management: {
        provider: 'none',
      },
    },
  })),
}));

vi.mock('../cli-runtimes/index.js', () => ({
  getCliRuntimeBuilder: vi.fn(() => ({
    buildSpawnCommand: vi.fn(() => ['claude', '--model', 'claude-sonnet-4-5']),
  })),
  resolveRuntimeModelForCli: vi.fn((model: string) => model),
}));

vi.mock('../utils/paths.js', () => ({
  findHiveRoot: vi.fn(() => '/tmp/test'),
  getHivePaths: vi.fn(() => ({
    hiveDir: '/tmp/test/.hive',
  })),
}));

describe('TechLeadAgent', () => {
  let db: Database;
  let provider: MockLLMProvider;
  let agentRow: AgentRow;
  let context: TechLeadContext;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(TEST_SCHEMA);

    provider = new MockLLMProvider();

    // Create teams
    db.run(`INSERT INTO teams (id, name, repo_url, repo_path) VALUES (?, ?, ?, ?)`, [
      'team-1',
      'Backend Team',
      'https://github.com/test/backend',
      'backend',
    ]);
    db.run(`INSERT INTO teams (id, name, repo_url, repo_path) VALUES (?, ?, ?, ?)`, [
      'team-2',
      'Frontend Team',
      'https://github.com/test/frontend',
      'frontend',
    ]);

    // Create agent
    db.run(`INSERT INTO agents (id, type, status) VALUES (?, ?, ?)`, [
      'agent-1',
      'tech_lead',
      'idle',
    ]);

    agentRow = queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', ['agent-1'])!;

    context = {
      agentRow,
      db,
      provider,
      workDir: '/tmp/test',
      config: {
        maxRetries: 3,
        checkpointThreshold: 10000,
        pollInterval: 1000,
        llmTimeoutMs: 30000,
        llmMaxRetries: 3,
      },
    };
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with all teams', () => {
      const agent = new TechLeadAgent(context);
      expect(agent).toBeDefined();
    });

    it('should load requirement if requirementId provided', () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      expect(agent).toBeDefined();
    });
  });

  describe('getSystemPrompt', () => {
    it('should include Tech Lead role description', () => {
      const agent = new TechLeadAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Tech Lead');
      expect(prompt).toContain('coordinate multiple autonomous teams');
    });

    it('should list all teams', () => {
      const agent = new TechLeadAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Backend Team');
      expect(prompt).toContain('Frontend Team');
      expect(prompt).toContain('backend');
      expect(prompt).toContain('frontend');
    });

    it('should include complexity guidelines', () => {
      const agent = new TechLeadAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Fibonacci scale');
      expect(prompt).toContain('1-3 points: Junior');
      expect(prompt).toContain('4-5 points: Intermediate');
      expect(prompt).toContain('6+ points: Senior');
    });

    it('should include escalation protocol', () => {
      const agent = new TechLeadAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Escalate to human');
      expect(prompt).toContain('Ambiguous requirements');
      expect(prompt).toContain('Architectural decisions');
    });

    it('should handle no teams configured', () => {
      db.run('DELETE FROM teams');

      const agent = new TechLeadAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('No teams configured yet');
    });
  });

  describe('execute', () => {
    it('should wait when no requirement assigned', async () => {
      const agent = new TechLeadAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string; message: string }>(
        db,
        'SELECT event_type, message FROM event_logs'
      );
      const waitLog = logs.find(l => l.message.includes('waiting for requirement'));
      expect(waitLog).toBeDefined();
    });

    it('should analyze requirement and create stories', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Add user authentication',
        'Users should be able to log in',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team'],
        stories: [
          {
            title: 'Create login API endpoint',
            description: 'Implement POST /api/login endpoint',
            acceptanceCriteria: ['Returns JWT token', 'Validates credentials'],
            teamName: 'Backend Team',
            estimatedComplexity: 5,
            dependencies: [],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const stories = queryAll<{ id: string; title: string }>(
        db,
        'SELECT id, title FROM stories WHERE requirement_id = ?',
        ['req-1']
      );
      expect(stories.length).toBeGreaterThan(0);
      expect(stories[0].title).toContain('login');
    });

    it('should update requirement status to planned', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team'],
        stories: [
          {
            title: 'Test Story',
            description: 'Description',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Backend Team',
            estimatedComplexity: 3,
            dependencies: [],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const req = queryOne<{ status: string }>(db, 'SELECT status FROM requirements WHERE id = ?', [
        'req-1',
      ]);
      expect(req?.status).toBe('planned');
    });
  });

  describe('requirement analysis', () => {
    it('should create multiple stories for complex requirements', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'User Management System',
        'Complete user management',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team', 'Frontend Team'],
        stories: [
          {
            title: 'Backend: User CRUD API',
            description: 'Create user management endpoints',
            acceptanceCriteria: ['CRUD operations work'],
            teamName: 'Backend Team',
            estimatedComplexity: 8,
            dependencies: [],
          },
          {
            title: 'Frontend: User Management UI',
            description: 'Create UI for user management',
            acceptanceCriteria: ['Users can manage accounts'],
            teamName: 'Frontend Team',
            estimatedComplexity: 5,
            dependencies: ['Backend: User CRUD API'],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const stories = queryAll<{ title: string }>(
        db,
        'SELECT title FROM stories WHERE requirement_id = ?',
        ['req-1']
      );
      expect(stories.length).toBe(2);
      expect(stories.some(s => s.title.includes('Backend'))).toBe(true);
      expect(stories.some(s => s.title.includes('Frontend'))).toBe(true);
    });

    it('should set up story dependencies', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team', 'Frontend Team'],
        stories: [
          {
            title: 'Story A',
            description: 'First story',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Backend Team',
            estimatedComplexity: 3,
            dependencies: [],
          },
          {
            title: 'Story B',
            description: 'Second story',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Frontend Team',
            estimatedComplexity: 3,
            dependencies: ['Story A'],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const dependencies = queryAll<{ story_id: string; depends_on_id: string }>(
        db,
        'SELECT story_id, depends_on_id FROM story_dependencies'
      );
      expect(dependencies.length).toBeGreaterThan(0);
    });

    it('should escalate when analysis needs human input', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Ambiguous Requirement',
        'Do something unclear',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: [],
        stories: [],
        needsHumanInput: true,
        escalationReason: 'Requirement is unclear and needs human clarification',
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const escalation = queryOne<{ reason: string }>(
        db,
        'SELECT reason FROM escalations WHERE from_agent_id = ?',
        ['agent-1']
      );
      expect(escalation).toBeDefined();
      expect(escalation?.reason).toContain('unclear');
    });

    it('should update agent status to blocked after escalation', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: [],
        stories: [],
        needsHumanInput: true,
        escalationReason: 'Need clarification',
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const updatedAgent = queryOne<{ status: string }>(
        db,
        'SELECT status FROM agents WHERE id = ?',
        ['agent-1']
      );
      expect(updatedAgent?.status).toBe('blocked');
    });
  });

  describe('senior coordination', () => {
    it('should spawn or assign senior agents for affected teams', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team'],
        stories: [
          {
            title: 'Test Story',
            description: 'Description',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Backend Team',
            estimatedComplexity: 3,
            dependencies: [],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const seniors = queryAll<{ type: string; team_id: string }>(
        db,
        "SELECT type, team_id FROM agents WHERE type = 'senior'"
      );
      expect(seniors.length).toBeGreaterThan(0);
      expect(seniors[0].team_id).toBe('team-1');
    });

    it('should mark stories as planned after assignment', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team'],
        stories: [
          {
            title: 'Test Story',
            description: 'Description',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Backend Team',
            estimatedComplexity: 3,
            dependencies: [],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const stories = queryAll<{ status: string }>(
        db,
        'SELECT status FROM stories WHERE requirement_id = ?',
        ['req-1']
      );
      expect(stories.every(s => s.status === 'planned')).toBe(true);
    });
  });

  describe('logging', () => {
    it('should log planning started', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: [],
        stories: [],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'PLANNING_STARTED')).toBe(true);
    });

    it('should log planning completed', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team'],
        stories: [
          {
            title: 'Test Story',
            description: 'Description',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Backend Team',
            estimatedComplexity: 3,
            dependencies: [],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'PLANNING_COMPLETED')).toBe(true);
    });

    it('should log story creation', async () => {
      db.run(`INSERT INTO requirements (id, title, description, status) VALUES (?, ?, ?, ?)`, [
        'req-1',
        'Test Requirement',
        'Description',
        'pending',
      ]);

      const analysisResponse = JSON.stringify({
        affectedTeams: ['Backend Team'],
        stories: [
          {
            title: 'Test Story',
            description: 'Description',
            acceptanceCriteria: ['AC 1'],
            teamName: 'Backend Team',
            estimatedComplexity: 3,
            dependencies: [],
          },
        ],
        needsHumanInput: false,
      });

      provider.setNextResponse(analysisResponse);

      const reqContext = { ...context, requirementId: 'req-1' };
      const agent = new TechLeadAgent(reqContext);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_CREATED')).toBe(true);
    });
  });
});
