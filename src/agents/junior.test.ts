// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryAll, queryOne } from '../db/client.js';
import type { AgentRow } from '../db/queries/agents.js';
import type { CompletionOptions, CompletionResult, LLMProvider, Message } from '../llm/provider.js';
import { JuniorAgent, type JuniorContext } from './junior.js';

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
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    team_id TEXT,
    status TEXT DEFAULT 'idle',
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
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    team_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    acceptance_criteria TEXT,
    complexity_score INTEGER,
    status TEXT DEFAULT 'draft',
    branch_name TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    story_id TEXT,
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

describe('JuniorAgent', () => {
  let db: Database;
  let provider: MockLLMProvider;
  let agentRow: AgentRow;
  let teamId: string;
  let context: JuniorContext;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(TEST_SCHEMA);

    provider = new MockLLMProvider();

    // Create a team
    db.run(`INSERT INTO teams (id, name, repo_path) VALUES (?, ?, ?)`, [
      'team-1',
      'Test Team',
      '/path/to/repo',
    ]);
    teamId = 'team-1';

    // Create agent
    db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
      'agent-1',
      'junior',
      teamId,
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
  });

  describe('constructor', () => {
    it('should initialize with team', () => {
      const agent = new JuniorAgent(context);
      expect(agent).toBeDefined();
    });

    it('should load story from context.storyId', () => {
      db.run(`INSERT INTO stories (id, team_id, title, status) VALUES (?, ?, ?, ?)`, [
        'story-1',
        teamId,
        'Test Story',
        'planned',
      ]);

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      expect(agent).toBeDefined();
    });

    it('should load story from agentRow.current_story_id', () => {
      db.run(`INSERT INTO stories (id, team_id, title, status) VALUES (?, ?, ?, ?)`, [
        'story-1',
        teamId,
        'Test Story',
        'planned',
      ]);
      db.run(`UPDATE agents SET current_story_id = ? WHERE id = ?`, ['story-1', 'agent-1']);

      agentRow = queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', ['agent-1'])!;
      const storyContext = { ...context, agentRow };
      const agent = new JuniorAgent(storyContext);
      expect(agent).toBeDefined();
    });
  });

  describe('getSystemPrompt', () => {
    it('should include team information', () => {
      const agent = new JuniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Junior Developer');
      expect(prompt).toContain('Test Team');
      expect(prompt).toContain('/path/to/repo');
    });

    it('should show "No team assigned" when team is null', () => {
      db.run(`UPDATE agents SET team_id = NULL WHERE id = ?`, ['agent-1']);
      agentRow = queryOne<AgentRow>(db, 'SELECT * FROM agents WHERE id = ?', ['agent-1'])!;

      const noTeamContext = { ...context, agentRow };
      const agent = new JuniorAgent(noTeamContext);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('No team assigned');
    });

    it('should include current story information', () => {
      db.run(`INSERT INTO stories (id, team_id, title, status) VALUES (?, ?, ?, ?)`, [
        'story-1',
        teamId,
        'Fix typo in README',
        'in_progress',
      ]);

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('story-1');
      expect(prompt).toContain('Fix typo in README');
      expect(prompt).toContain('in_progress');
    });

    it('should show "No story assigned" when no story', () => {
      const agent = new JuniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('No story assigned');
    });

    it('should mention complexity range 1-3 points', () => {
      const agent = new JuniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('1-3 complexity points');
    });

    it('should emphasize following patterns exactly', () => {
      const agent = new JuniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Follow coding patterns exactly');
      expect(prompt).toContain('Match the coding style exactly');
    });

    it('should warn against architectural decisions', () => {
      const agent = new JuniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('should NOT make architectural decisions');
      expect(prompt).toContain('should NOT refactor unrelated code');
    });

    it('should encourage asking for help', () => {
      const agent = new JuniorAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Ask questions when unsure');
      expect(prompt).toContain('Ask for help early');
    });
  });

  describe('execute', () => {
    it('should wait when no story assigned', async () => {
      const agent = new JuniorAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string; message: string }>(
        db,
        'SELECT event_type, message FROM event_logs'
      );
      const waitLog = logs.find(l => l.message.includes('waiting'));
      expect(waitLog).toBeDefined();
    });

    it('should implement assigned story', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, complexity_score) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Fix typo', 'Description', 'planned', 1]
      );

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('review');
    });

    it('should set branch name when implementing story', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Add button', 'Description', 'planned']
      );

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      await agent.execute();

      const story = queryOne<{ branch_name: string }>(
        db,
        'SELECT branch_name FROM stories WHERE id = ?',
        ['story-1']
      );
      expect(story?.branch_name).toContain('feature/story-1');
    });

    it('should use existing branch name if set', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, branch_name) VALUES (?, ?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned', 'feature/existing']
      );

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      await agent.execute();

      const story = queryOne<{ branch_name: string }>(
        db,
        'SELECT branch_name FROM stories WHERE id = ?',
        ['story-1']
      );
      expect(story?.branch_name).toBe('feature/existing');
    });
  });

  describe('retry and escalation', () => {
    it('should escalate to senior after just 1 retry', async () => {
      // Create senior agent
      db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
        'senior-1',
        'senior',
        teamId,
        'idle',
      ]);

      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      // Mock a failure
      provider.complete = async () => {
        throw new Error('Test error');
      };

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);

      await agent.execute();

      const escalation = queryOne<{ from_agent_id: string; to_agent_id: string }>(
        db,
        'SELECT from_agent_id, to_agent_id FROM escalations WHERE from_agent_id = ?',
        ['agent-1']
      );

      expect(escalation).toBeDefined();
      expect(escalation?.to_agent_id).toBe('senior-1');
    });

    it('should update status to blocked after escalation', async () => {
      db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
        'senior-1',
        'senior',
        teamId,
        'idle',
      ]);

      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      provider.complete = async () => {
        throw new Error('Test error');
      };

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);

      await agent.execute();

      const updatedAgent = queryOne<{ status: string }>(
        db,
        'SELECT status FROM agents WHERE id = ?',
        ['agent-1']
      );

      expect(updatedAgent?.status).toBe('blocked');
    });

    it('should escalate faster than intermediate (after 1 retry vs 2+)', async () => {
      db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
        'senior-1',
        'senior',
        teamId,
        'idle',
      ]);

      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      let callCount = 0;
      provider.complete = async () => {
        callCount++;
        throw new Error('Test error');
      };

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);

      await agent.execute();

      // Junior should escalate after just 1 retry
      const escalation = queryOne<{ from_agent_id: string }>(
        db,
        'SELECT from_agent_id FROM escalations WHERE from_agent_id = ?',
        ['agent-1']
      );

      expect(escalation).toBeDefined();
      expect(callCount).toBeLessThanOrEqual(2); // Initial attempt + 1 retry
    });
  });

  describe('logging', () => {
    it('should log story start', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_STARTED')).toBe(true);
    });

    it('should log story completion', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_COMPLETED')).toBe(true);
    });

    it('should log escalation creation', async () => {
      db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
        'senior-1',
        'senior',
        teamId,
        'idle',
      ]);

      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      provider.complete = async () => {
        throw new Error('Test error');
      };

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);

      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'ESCALATION_CREATED')).toBe(true);
    });

    it('should log analyzing task', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, description, status) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'Description', 'planned']
      );

      const storyContext = { ...context, storyId: 'story-1' };
      const agent = new JuniorAgent(storyContext);
      await agent.execute();

      const logs = queryAll<{ message: string }>(db, 'SELECT message FROM event_logs');
      const analyzeLog = logs.find(l => l.message.includes('Analyzing'));
      expect(analyzeLog).toBeDefined();
    });
  });
});
