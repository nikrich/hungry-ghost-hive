// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryAll, queryOne } from '../db/client.js';
import type { AgentRow } from '../db/queries/agents.js';
import type { CompletionOptions, CompletionResult, LLMProvider, Message } from '../llm/provider.js';
import { SeniorAgent, type SeniorContext } from './senior.js';

// Mock LLM Provider
class MockLLMProvider implements LLMProvider {
  name = 'mock-provider';

  async complete(_messages: Message[], _options?: CompletionOptions): Promise<CompletionResult> {
    return {
      content: 'Mock response',
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
    status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'working', 'blocked', 'terminated')),
    current_story_id TEXT,
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
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    requirement_id TEXT,
    team_id TEXT REFERENCES teams(id),
    title TEXT NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    complexity_score INTEGER,
    status TEXT DEFAULT 'draft',
    assigned_agent_id TEXT,
    branch_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS story_dependencies (
    story_id TEXT REFERENCES stories(id),
    depends_on_story_id TEXT REFERENCES stories(id),
    PRIMARY KEY (story_id, depends_on_story_id)
);

CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    story_id TEXT,
    event_type TEXT NOT NULL,
    message TEXT,
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    story_id TEXT,
    from_agent_id TEXT,
    to_agent_id TEXT,
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

describe('SeniorAgent', () => {
  let db: Database;
  let provider: MockLLMProvider;
  let agentRow: AgentRow;
  let teamId: string;
  let context: SeniorContext;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(TEST_SCHEMA);

    provider = new MockLLMProvider();

    // Create a team
    db.run(`INSERT INTO teams (id, name, repo_url, repo_path) VALUES (?, ?, ?, ?)`, [
      'team-1',
      'Test Team',
      'https://github.com/test/repo',
      '/path/to/repo',
    ]);
    teamId = 'team-1';

    // Create agent
    db.run(`INSERT INTO agents (id, type, team_id, status, tmux_session) VALUES (?, ?, ?, ?, ?)`, [
      'agent-1',
      'senior',
      teamId,
      'idle',
      'test-session',
    ]);

    agentRow = queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', ['agent-1'])!;

    context = {
      agentRow,
      db,
      provider,
      workDir: '/tmp/test',
      teamId,
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
  });

  describe('constructor', () => {
    it('should initialize with team and assigned stories', () => {
      // Create some stories
      db.run(
        `INSERT INTO stories (id, team_id, title, status, complexity_score) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story 1', 'planned', 3]
      );
      db.run(
        `INSERT INTO stories (id, team_id, title, status, complexity_score) VALUES (?, ?, ?, ?, ?)`,
        ['story-2', teamId, 'Test Story 2', 'in_progress', 5]
      );
      db.run(
        `INSERT INTO stories (id, team_id, title, status, complexity_score) VALUES (?, ?, ?, ?, ?)`,
        ['story-3', teamId, 'Test Story 3', 'completed', 2]
      );

      const agent = new SeniorAgent(context);
      expect(agent).toBeDefined();
    });

    it('should handle no team assigned', () => {
      const noTeamContext = { ...context, teamId: '' };
      const agent = new SeniorAgent(noTeamContext);
      expect(agent).toBeDefined();
    });
  });

  describe('getSystemPrompt', () => {
    it('should include team information when team is assigned', () => {
      const agent = new SeniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Senior Developer');
      expect(prompt).toContain('Test Team');
      expect(prompt).toContain('https://github.com/test/repo');
      expect(prompt).toContain('/path/to/repo');
    });

    it('should show "No team assigned" when team is not assigned', () => {
      db.run(`UPDATE agents SET team_id = NULL WHERE id = ?`, ['agent-1']);
      agentRow = queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', ['agent-1'])!;

      const noTeamContext = { ...context, agentRow, teamId: '' };
      const agent = new SeniorAgent(noTeamContext);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('No team assigned');
    });

    it('should list assigned stories in the prompt', () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, complexity_score) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Implement feature X', 'planned', 5]
      );
      db.run(
        `INSERT INTO stories (id, team_id, title, status, complexity_score) VALUES (?, ?, ?, ?, ?)`,
        ['story-2', teamId, 'Fix bug Y', 'in_progress', 3]
      );

      const agent = new SeniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('story-1');
      expect(prompt).toContain('Implement feature X');
      expect(prompt).toContain('story-2');
      expect(prompt).toContain('Fix bug Y');
    });

    it('should show "No stories assigned" when no active stories', () => {
      const agent = new SeniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('No stories assigned');
    });

    it('should include responsibilities and guidelines', () => {
      const agent = new SeniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Responsibilities');
      expect(prompt).toContain('codebase analysis');
      expect(prompt).toContain('Development Guidelines');
      expect(prompt).toContain('feature branches');
    });
  });

  describe('execute', () => {
    it('should wait when no team assigned', async () => {
      db.run(`UPDATE agents SET team_id = NULL WHERE id = ?`, ['agent-1']);
      agentRow = queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', ['agent-1'])!;

      const noTeamContext = { ...context, agentRow, teamId: '' };
      const agent = new SeniorAgent(noTeamContext);

      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'CODEBASE_SWEEP_STARTED')).toBe(true);
    });

    it('should process planned stories', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, complexity_score) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned', 5]
      );

      const agent = new SeniorAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('review');
    });

    it('should review stories in review status', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, branch_name) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'review', 'feature/test']
      );

      const agent = new SeniorAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_REVIEW_REQUESTED')).toBe(true);
    });
  });

  describe('escalateToTechLead', () => {
    it('should create escalation to tech lead', async () => {
      // Create tech lead
      db.run(`INSERT INTO agents (id, type, status) VALUES (?, ?, ?)`, [
        'tech-lead-1',
        'tech_lead',
        'idle',
      ]);

      const agent = new SeniorAgent(context);
      await agent.escalateToTechLead('Test escalation reason');

      const escalation = queryOne<{ reason: string; to_agent_id: string }>(
        db,
        'SELECT reason, to_agent_id FROM escalations WHERE from_agent_id = ?',
        ['agent-1']
      );

      expect(escalation).toBeDefined();
      expect(escalation?.reason).toBe('Test escalation reason');
      expect(escalation?.to_agent_id).toBe('tech-lead-1');
    });

    it('should update agent status to blocked after escalation', async () => {
      db.run(`INSERT INTO agents (id, type, status) VALUES (?, ?, ?)`, [
        'tech-lead-1',
        'tech_lead',
        'idle',
      ]);

      const agent = new SeniorAgent(context);
      await agent.escalateToTechLead('Blocked by external dependency');

      const updatedAgent = queryOne<{ status: string }>(
        db,
        'SELECT status FROM agents WHERE id = ?',
        ['agent-1']
      );

      expect(updatedAgent?.status).toBe('blocked');
    });

    it('should log escalation event', async () => {
      db.run(`INSERT INTO agents (id, type, status) VALUES (?, ?, ?)`, [
        'tech-lead-1',
        'tech_lead',
        'idle',
      ]);

      const agent = new SeniorAgent(context);
      await agent.escalateToTechLead('Need architectural guidance');

      const logs = queryAll<{ event_type: string; details: string }>(
        db,
        'SELECT event_type, details FROM event_logs WHERE agent_id = ?',
        ['agent-1']
      );

      const escalationLog = logs.find(l => l.event_type === 'ESCALATION_CREATED');
      expect(escalationLog).toBeDefined();
    });
  });

  describe('story implementation', () => {
    it('should update story status to in_progress when starting implementation', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, complexity_score) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned', 5]
      );

      const agent = new SeniorAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_STARTED')).toBe(true);
    });

    it('should set branch name for story', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, complexity_score) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Implement Feature', 'Description', 'planned', 5]
      );

      const agent = new SeniorAgent(context);
      await agent.execute();

      const story = queryOne<{ branch_name: string }>(
        db,
        'SELECT branch_name FROM stories WHERE id = ?',
        ['story-1']
      );
      expect(story?.branch_name).toContain('feature/story-1');
    });

    it('should mark story for review after completion', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, complexity_score) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned', 5]
      );

      const agent = new SeniorAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('review');
    });
  });

  describe('story review', () => {
    it('should move self-implemented story to QA', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, assigned_agent_id) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'review', 'agent-1']
      );

      const agent = new SeniorAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('qa');
    });

    it('should review stories implemented by others', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, assigned_agent_id, branch_name) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'review', 'other-agent', 'feature/test']
      );

      vi.spyOn(provider, 'complete').mockResolvedValue({
        content: 'Review looks good',
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const agent = new SeniorAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_REVIEW_REQUESTED')).toBe(true);
    });

    it('should send story back to in_progress if issues found', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, assigned_agent_id, branch_name) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'review', 'other-agent', 'feature/test']
      );

      vi.spyOn(provider, 'complete').mockResolvedValue({
        content: 'Found several issues that need to be fixed',
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const agent = new SeniorAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('in_progress');
    });
  });
});
