// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryAll, queryOne } from '../db/client.js';
import type { AgentRow } from '../db/queries/agents.js';
import type { CompletionOptions, CompletionResult, LLMProvider, Message } from '../llm/provider.js';
import { QAAgent, type QAContext } from './qa.js';

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

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '' }),
}));

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

CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    story_id TEXT,
    team_id TEXT,
    branch_name TEXT,
    github_pr_number INTEGER,
    github_pr_url TEXT
);
`;

describe('QAAgent', () => {
  let db: Database;
  let provider: MockLLMProvider;
  let agentRow: AgentRow;
  let teamId: string;
  let context: QAContext;

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
      'qa',
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
      qaConfig: {
        qualityChecks: ['npm run lint', 'npm run type-check'],
        buildCommand: 'npm run build',
        testCommand: 'npm test',
      },
    };
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with team and QA config', () => {
      const agent = new QAAgent(context);
      expect(agent).toBeDefined();
    });

    it('should load pending QA stories for team', () => {
      db.run(`INSERT INTO stories (id, team_id, title, status) VALUES (?, ?, ?, ?)`, [
        'story-1',
        teamId,
        'Test Story 1',
        'qa',
      ]);
      db.run(`INSERT INTO stories (id, team_id, title, status) VALUES (?, ?, ?, ?)`, [
        'story-2',
        teamId,
        'Test Story 2',
        'qa',
      ]);

      const agent = new QAAgent(context);
      expect(agent).toBeDefined();
    });
  });

  describe('getSystemPrompt', () => {
    it('should include team information', () => {
      const agent = new QAAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('QA Agent');
      expect(prompt).toContain('Test Team');
      expect(prompt).toContain('/path/to/repo');
    });

    it('should include quality checklist', () => {
      const agent = new QAAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Quality Checklist');
      expect(prompt).toContain('linting');
      expect(prompt).toContain('type checking');
      expect(prompt).toContain('Build succeeds');
    });

    it('should include configured commands', () => {
      const agent = new QAAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('npm run lint');
      expect(prompt).toContain('npm run type-check');
      expect(prompt).toContain('npm run build');
      expect(prompt).toContain('npm test');
    });

    it('should describe failure and success workflows', () => {
      const agent = new QAAgent(context);
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('On Failure');
      expect(prompt).toContain('qa_failed');
      expect(prompt).toContain('On Success');
      expect(prompt).toContain('pr_submitted');
    });

    it('should handle missing test command', () => {
      const noTestContext = {
        ...context,
        qaConfig: {
          ...context.qaConfig,
          testCommand: undefined,
        },
      };
      const agent = new QAAgent(noTestContext);
      const prompt = agent.getSystemPrompt();

      expect(prompt).not.toContain('Test:');
    });
  });

  describe('execute', () => {
    it('should wait when no stories pending QA', async () => {
      const agent = new QAAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string; message: string }>(
        db,
        'SELECT event_type, message FROM event_logs'
      );
      const qaLog = logs.find(l => l.message.includes('No stories pending QA'));
      expect(qaLog).toBeDefined();
    });

    it('should process multiple QA stories', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Story 1', 'qa', 'feature/story-1']
      );
      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-2', teamId, 'Story 2', 'qa', 'feature/story-2']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(
        db,
        'SELECT event_type FROM event_logs WHERE event_type = ?',
        ['STORY_QA_STARTED']
      );
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('QA workflow', () => {
    it('should mark story as pr_submitted when all checks pass', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('pr_submitted');
    });

    it('should log QA passed event', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'STORY_QA_PASSED')).toBe(true);
    });

    it('should create PR when QA passes', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/123',
      } as any);

      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const pr = queryOne<{ github_pr_url: string }>(
        db,
        'SELECT github_pr_url FROM pull_requests WHERE story_id = ?',
        ['story-1']
      );
      expect(pr).toBeDefined();
    });
  });

  describe('QA failure scenarios', () => {
    it('should mark story as qa_failed when quality checks fail', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValueOnce(new Error('Linting failed'));

      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('qa_failed');
    });

    it('should mark story as qa_failed when build fails', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any) // git checkout
        .mockResolvedValueOnce({ stdout: '' } as any) // lint
        .mockResolvedValueOnce({ stdout: '' } as any) // type-check
        .mockRejectedValueOnce(new Error('Build failed')); // build

      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('qa_failed');
    });

    it('should mark story as qa_failed when tests fail', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any) // git checkout
        .mockResolvedValueOnce({ stdout: '' } as any) // lint
        .mockResolvedValueOnce({ stdout: '' } as any) // type-check
        .mockResolvedValueOnce({ stdout: '' } as any) // build
        .mockRejectedValueOnce(new Error('Tests failed')); // tests

      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const story = queryOne<{ status: string }>(db, 'SELECT status FROM stories WHERE id = ?', [
        'story-1',
      ]);
      expect(story?.status).toBe('qa_failed');
    });

    it('should log failure details', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValueOnce(
        Object.assign(new Error('Check failed'), { stderr: 'Linting error details' })
      );

      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const logs = queryAll<{ event_type: string }>(db, 'SELECT event_type FROM event_logs');
      expect(logs.some(l => l.event_type === 'CODE_QUALITY_CHECK_FAILED')).toBe(true);
    });
  });

  describe('escalation after repeated failures', () => {
    it('should escalate to senior after 3 QA failures', async () => {
      // Create senior agent
      db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
        'senior-1',
        'senior',
        teamId,
        'idle',
      ]);

      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      // Add 3 QA failure logs
      for (let i = 0; i < 3; i++) {
        db.run(
          `INSERT INTO event_logs (agent_id, story_id, event_type, message) VALUES (?, ?, ?, ?)`,
          ['agent-1', 'story-1', 'STORY_QA_FAILED', `Failure ${i + 1}`]
        );
      }

      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValueOnce(new Error('Check failed'));

      const agent = new QAAgent(context);
      await agent.execute();

      const escalation = queryOne<{ from_agent_id: string; to_agent_id: string }>(
        db,
        'SELECT from_agent_id, to_agent_id FROM escalations WHERE story_id = ?',
        ['story-1']
      );

      expect(escalation).toBeDefined();
      expect(escalation?.to_agent_id).toBe('senior-1');
    });
  });

  describe('PR generation', () => {
    it('should generate PR body with story details', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'https://github.com/test/repo/pull/123',
      } as any);

      db.run(
        `INSERT INTO stories (id, team_id, title, description, status, branch_name, acceptance_criteria) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          'story-1',
          teamId,
          'Test Story',
          'Story description',
          'qa',
          'feature/test',
          JSON.stringify(['Criteria 1', 'Criteria 2']),
        ]
      );

      const agent = new QAAgent(context);
      await agent.execute();

      // Verify gh pr create was called
      expect(vi.mocked(execa)).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['pr', 'create']),
        expect.any(Object)
      );
    });

    it('should not create duplicate PR if one already exists', async () => {
      db.run(
        `INSERT INTO stories (id, team_id, title, status, branch_name) VALUES (?, ?, ?, ?, ?)`,
        ['story-1', teamId, 'Test Story', 'qa', 'feature/test']
      );

      // Create existing PR
      db.run(
        `INSERT INTO pull_requests (id, story_id, team_id, branch_name, github_pr_url) VALUES (?, ?, ?, ?, ?)`,
        ['pr-1', 'story-1', teamId, 'feature/test', 'https://github.com/test/repo/pull/1']
      );

      const agent = new QAAgent(context);
      await agent.execute();

      const logs = queryAll<{ message: string }>(
        db,
        'SELECT message FROM event_logs WHERE event_type = ?',
        ['STORY_PR_CREATED']
      );
      const existingPRLog = logs.find(l => l.message.includes('already exists'));
      expect(existingPRLog).toBeDefined();
    });
  });
});
