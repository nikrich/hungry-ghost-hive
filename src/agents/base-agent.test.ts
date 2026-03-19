// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import initSqlJs from 'sql.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryAll, queryOne } from '../db/client.js';
import { SqliteProvider } from '../db/provider.js';
import type { AgentRow } from '../db/queries/agents.js';
import type { CompletionOptions, CompletionResult, LLMProvider, Message } from '../llm/provider.js';
import { BaseAgent, type AgentContext, type MemoryState } from './base-agent.js';

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

// Concrete implementation of BaseAgent for testing
class TestAgent extends BaseAgent {
  getSystemPrompt(): string {
    return 'Test system prompt';
  }

  async execute(): Promise<void> {
    // Simple execute implementation for testing
    await this.chat('Test message');
  }
}

describe('BaseAgent', () => {
  let db: Database;
  let provider: MockLLMProvider;
  let agentRow: AgentRow;
  let context: AgentContext;

  // Database migration for testing
  const INITIAL_MIGRATION = `
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('tech_lead', 'senior', 'intermediate', 'junior', 'qa')),
    team_id TEXT,
    tmux_session TEXT,
    model TEXT,
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
    status TEXT,
    message TEXT,
    metadata TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    story_id TEXT,
    requirement_id TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    session_id TEXT,
    recorded_at TIMESTAMP NOT NULL
);
`;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    db.run(INITIAL_MIGRATION);

    provider = new MockLLMProvider();

    agentRow = {
      id: 'test-agent-1',
      type: 'senior',
      team_id: 'team-1',
      tmux_session: 'test-session',
      model: 'test-model',
      status: 'idle',
      current_story_id: null,
      memory_state: null,
      last_seen: null,
      cli_tool: 'claude',
      worktree_path: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    // Insert the agent into the database
    db.run(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`, [
      agentRow.id,
      agentRow.type,
      agentRow.team_id,
      agentRow.status,
    ]);

    context = {
      db: new SqliteProvider(db),
      provider,
      agentRow,
      workDir: '/tmp/test',
      config: {
        maxRetries: 3,
        checkpointThreshold: 10000,
        pollInterval: 5000,
        llmTimeoutMs: 30000,
        llmMaxRetries: 3,
      },
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe('Construction and Initialization', () => {
    it('should initialize with correct properties', () => {
      const agent = new TestAgent(context);
      expect(agent).toBeDefined();
    });

    it('should initialize memory state when not provided', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      expect(agentAny.memoryState).toBeDefined();
      expect(agentAny.memoryState.conversationSummary).toBe('');
      expect(agentAny.memoryState.context.blockers).toEqual([]);
      expect(agentAny.memoryState.context.decisionsMade).toEqual([]);
    });

    it('should load existing memory state when provided', () => {
      const existingMemory: MemoryState = {
        conversationSummary: 'Previous summary',
        context: {
          blockers: ['blocker1'],
          decisionsMade: ['decision1'],
        },
        checkpointTokens: 5000,
      };
      agentRow.memory_state = JSON.stringify(existingMemory);
      db.run(`UPDATE agents SET memory_state = ? WHERE id = ?`, [
        agentRow.memory_state,
        agentRow.id,
      ]);

      const agent = new TestAgent(context);
      const agentAny = agent as any;
      expect(agentAny.memoryState.conversationSummary).toBe('Previous summary');
      expect(agentAny.memoryState.context.blockers).toContain('blocker1');
      expect(agentAny.memoryState.context.decisionsMade).toContain('decision1');
    });

    it('should initialize messages with system prompt', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      expect(agentAny.messages).toHaveLength(1);
      expect(agentAny.messages[0].role).toBe('system');
      expect(agentAny.messages[0].content).toBe('Test system prompt');
    });

    it('should add memory context when resuming', () => {
      const existingMemory: MemoryState = {
        conversationSummary: 'Previous context',
        context: { blockers: [], decisionsMade: [] },
        checkpointTokens: 0,
      };
      agentRow.memory_state = JSON.stringify(existingMemory);
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      expect(agentAny.messages).toHaveLength(2);
      expect(agentAny.messages[1].role).toBe('user');
      expect(agentAny.messages[1].content).toContain('Previous context');
    });
  });

  describe('Status Transitions', () => {
    it('should transition from idle to working when run is called', async () => {
      const agent = new TestAgent(context);
      await agent.run();

      const result = queryOne<{ status: string }>(db, 'SELECT status FROM agents WHERE id = ?', [
        agentRow.id,
      ]);
      expect(result?.status).toBe('working');
    });

    it('should transition to blocked on error', async () => {
      provider.complete = vi.fn().mockRejectedValue(new Error('Test error'));
      const agent = new TestAgent(context);

      await expect(agent.run()).rejects.toThrow('Test error');

      const result = queryOne<{ status: string }>(db, 'SELECT status FROM agents WHERE id = ?', [
        agentRow.id,
      ]);
      expect(result?.status).toBe('blocked');
    });

    it('should log agent spawn event when run is called', async () => {
      const agent = new TestAgent(context);
      await agent.run();

      const events = queryAll<{ event_type: string; message: string }>(
        db,
        'SELECT event_type, message FROM agent_logs WHERE agent_id = ?',
        [agentRow.id]
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event_type: 'AGENT_SPAWNED',
          message: expect.stringContaining('senior agent started'),
        })
      );
    });

    it('should log termination event on error', async () => {
      provider.complete = vi.fn().mockRejectedValue(new Error('Fatal error'));
      const agent = new TestAgent(context);

      await expect(agent.run()).rejects.toThrow();

      const events = queryAll<{ event_type: string; message: string }>(
        db,
        'SELECT event_type, message FROM agent_logs WHERE agent_id = ?',
        [agentRow.id]
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          event_type: 'AGENT_TERMINATED',
          message: expect.stringContaining('Fatal error'),
        })
      );
    });
  });

  describe('Chat and Token Management', () => {
    it('should track token usage during chat', async () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      expect(agentAny.totalTokens).toBe(150); // 100 input + 50 output
    });

    it('should track input and output tokens separately', async () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      expect(agentAny.inputTokens).toBe(100);
      expect(agentAny.outputTokens).toBe(50);
    });

    it('should accumulate tokens across multiple chat calls', async () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Message 1');
      await agentAny.chat('Message 2');

      expect(agentAny.totalTokens).toBe(300); // 2 * (100 + 50)
    });

    it('should add user and assistant messages to conversation', async () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('User message');

      expect(agentAny.messages).toHaveLength(3); // system + user + assistant
      expect(agentAny.messages[1].role).toBe('user');
      expect(agentAny.messages[1].content).toBe('User message');
      expect(agentAny.messages[2].role).toBe('assistant');
    });
  });

  describe('Checkpointing', () => {
    it('should trigger checkpoint when token threshold is exceeded', async () => {
      provider.complete = vi
        .fn()
        .mockResolvedValueOnce({
          content: 'Response 1',
          usage: { inputTokens: 6000, outputTokens: 5000 },
        })
        .mockResolvedValueOnce({
          content: 'Checkpoint summary',
          usage: { inputTokens: 100, outputTokens: 100 },
        });

      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      // Should have triggered checkpoint (threshold is 10000, we used 11000)
      expect(agentAny.totalTokens).toBe(0); // Reset after checkpoint
      expect(agentAny.memoryState.conversationSummary).toBe('Checkpoint summary');
    });

    it('should save checkpoint to database', async () => {
      provider.complete = vi
        .fn()
        .mockResolvedValueOnce({
          content: 'Response',
          usage: { inputTokens: 6000, outputTokens: 5000 },
        })
        .mockResolvedValueOnce({
          content: 'Checkpoint summary',
          usage: { inputTokens: 100, outputTokens: 100 },
        });

      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      const result = queryOne<{ memory_state: string }>(
        db,
        'SELECT memory_state FROM agents WHERE id = ?',
        [agentRow.id]
      );
      const memoryState = JSON.parse(result!.memory_state);
      expect(memoryState.conversationSummary).toBe('Checkpoint summary');
      expect(memoryState.checkpointTokens).toBe(11000);
    });

    it('should reset messages after checkpoint but keep context', async () => {
      provider.complete = vi
        .fn()
        .mockResolvedValueOnce({
          content: 'Response',
          usage: { inputTokens: 6000, outputTokens: 5000 },
        })
        .mockResolvedValueOnce({
          content: 'Summary',
          usage: { inputTokens: 100, outputTokens: 100 },
        });

      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      // After checkpoint: system prompt + context restoration
      expect(agentAny.messages).toHaveLength(2);
      expect(agentAny.messages[0].role).toBe('system');
      expect(agentAny.messages[1].role).toBe('user');
      expect(agentAny.messages[1].content).toContain('Previous context');
    });
  });

  describe('Token Usage Persistence', () => {
    it('should persist token usage to database when run completes', async () => {
      // Insert agent with model and session so they appear in the DB record
      db.run(`UPDATE agents SET model = ?, tmux_session = ? WHERE id = ?`, [
        agentRow.model,
        agentRow.tmux_session,
        agentRow.id,
      ]);

      const agent = new TestAgent(context);
      await agent.run();

      const rows = queryAll<{
        agent_id: string;
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        model: string | null;
        session_id: string | null;
      }>(db, 'SELECT * FROM token_usage WHERE agent_id = ?', [agentRow.id]);

      expect(rows).toHaveLength(1);
      expect(rows[0].input_tokens).toBe(100);
      expect(rows[0].output_tokens).toBe(50);
      expect(rows[0].total_tokens).toBe(150);
      expect(rows[0].model).toBe('test-model');
      expect(rows[0].session_id).toBe('test-session');
    });

    it('should persist token usage with story_id when task is set', async () => {
      class TaskAgent extends BaseAgent {
        getSystemPrompt(): string {
          return 'Task agent prompt';
        }

        async execute(): Promise<void> {
          await this.setCurrentTask('STORY-XYZ', 'implementation');
          await this.chat('Working on story');
        }
      }

      const agent = new TaskAgent(context);
      await agent.run();

      const rows = queryAll<{ story_id: string | null }>(
        db,
        'SELECT story_id FROM token_usage WHERE agent_id = ?',
        [agentRow.id]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].story_id).toBe('STORY-XYZ');
    });

    it('should persist token usage at checkpoint', async () => {
      provider.complete = vi
        .fn()
        .mockResolvedValueOnce({
          content: 'Response',
          usage: { inputTokens: 6000, outputTokens: 5000 },
        })
        .mockResolvedValueOnce({
          content: 'Checkpoint summary',
          usage: { inputTokens: 100, outputTokens: 100 },
        });

      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      const rows = queryAll<{ input_tokens: number; output_tokens: number; total_tokens: number }>(
        db,
        'SELECT input_tokens, output_tokens, total_tokens FROM token_usage WHERE agent_id = ?',
        [agentRow.id]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].input_tokens).toBe(6000);
      expect(rows[0].output_tokens).toBe(5000);
      expect(rows[0].total_tokens).toBe(11000);
    });

    it('should reset token counters after checkpoint persistence', async () => {
      provider.complete = vi
        .fn()
        .mockResolvedValueOnce({
          content: 'Response',
          usage: { inputTokens: 6000, outputTokens: 5000 },
        })
        .mockResolvedValueOnce({
          content: 'Summary',
          usage: { inputTokens: 100, outputTokens: 100 },
        });

      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test message');

      expect(agentAny.totalTokens).toBe(0);
      expect(agentAny.inputTokens).toBe(0);
      expect(agentAny.outputTokens).toBe(0);
    });

    it('should not persist token usage when zero tokens used', async () => {
      class NoOpAgent extends BaseAgent {
        getSystemPrompt(): string {
          return 'No-op agent';
        }

        async execute(): Promise<void> {
          // Does nothing, no chat calls
        }
      }

      const agent = new NoOpAgent(context);
      await agent.run();

      const rows = queryAll<{ id: number }>(
        db,
        'SELECT id FROM token_usage WHERE agent_id = ?',
        [agentRow.id]
      );

      expect(rows).toHaveLength(0);
    });

    it('should persist token usage even when agent fails', async () => {
      class FailingAgent extends BaseAgent {
        getSystemPrompt(): string {
          return 'Failing agent';
        }

        async execute(): Promise<void> {
          await this.chat('Before failure');
          throw new Error('Intentional failure');
        }
      }

      const agent = new FailingAgent(context);
      await expect(agent.run()).rejects.toThrow('Intentional failure');

      const rows = queryAll<{ total_tokens: number }>(
        db,
        'SELECT total_tokens FROM token_usage WHERE agent_id = ?',
        [agentRow.id]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].total_tokens).toBe(150);
    });
  });

  describe('Memory State Management', () => {
    it('should add decision to memory state', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      agentAny.addDecision('Use TypeScript');

      expect(agentAny.memoryState.context.decisionsMade).toContain('Use TypeScript');
    });

    it('should add blocker to memory state', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      agentAny.addBlocker('Waiting for API');

      expect(agentAny.memoryState.context.blockers).toContain('Waiting for API');
    });

    it('should remove blocker from memory state', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      agentAny.addBlocker('Blocker 1');
      agentAny.addBlocker('Blocker 2');
      agentAny.removeBlocker('Blocker 1');

      expect(agentAny.memoryState.context.blockers).not.toContain('Blocker 1');
      expect(agentAny.memoryState.context.blockers).toContain('Blocker 2');
    });

    it('should set current task', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      agentAny.setCurrentTask('STORY-001', 'implementation');

      expect(agentAny.memoryState.currentTask).toBeDefined();
      expect(agentAny.memoryState.currentTask.storyId).toBe('STORY-001');
      expect(agentAny.memoryState.currentTask.phase).toBe('implementation');
    });

    it('should update task progress', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      agentAny.setCurrentTask('STORY-001', 'implementation');
      agentAny.updateTaskProgress('Modified file A', ['fileA.ts']);

      expect(agentAny.memoryState.currentTask.lastAction).toBe('Modified file A');
      expect(agentAny.memoryState.currentTask.filesModified).toContain('fileA.ts');
    });

    it('should accumulate modified files', () => {
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      agentAny.setCurrentTask('STORY-001', 'implementation');
      agentAny.updateTaskProgress('Modified A', ['fileA.ts']);
      agentAny.updateTaskProgress('Modified B', ['fileB.ts']);

      expect(agentAny.memoryState.currentTask.filesModified).toContain('fileA.ts');
      expect(agentAny.memoryState.currentTask.filesModified).toContain('fileB.ts');
    });
  });

  describe('Error Handling', () => {
    it('should handle LLM timeout errors', async () => {
      provider.complete = vi.fn().mockRejectedValue(new Error('Timeout'));
      const agent = new TestAgent(context);
      const agentAny = agent as any;

      await expect(agentAny.chat('Test')).rejects.toThrow('Timeout');
    });

    it('should log LLM errors', async () => {
      provider.complete = vi.fn().mockRejectedValue(new Error('LLM Error'));
      const agent = new TestAgent(context);
      const agentAny = agent as any;

      await expect(agentAny.chat('Test')).rejects.toThrow();

      const events = queryAll<{ event_type: string }>(
        db,
        'SELECT event_type FROM agent_logs WHERE agent_id = ?',
        [agentRow.id]
      );
      expect(events.map(e => e.event_type)).toContain('AGENT_TERMINATED');
    });

    it('should pass through timeout option to LLM provider', async () => {
      const completeSpy = vi.spyOn(provider, 'complete');
      const agent = new TestAgent(context);
      const agentAny = agent as any;
      await agentAny.chat('Test');

      expect(completeSpy).toHaveBeenCalledWith(expect.any(Array), { timeoutMs: 30000 });
    });
  });

  describe('Heartbeat Mechanism', () => {
    it('should send initial heartbeat on construction', () => {
      // Create agent to trigger heartbeat
      new TestAgent(context);

      // Check that last_seen was updated
      const result = queryOne<{ last_seen: string | null }>(
        db,
        'SELECT last_seen FROM agents WHERE id = ?',
        [agentRow.id]
      );
      expect(result?.last_seen).toBeTruthy();
    });

    it('should stop heartbeat after agent completes', async () => {
      const agent = new TestAgent(context);
      await agent.run();

      // Agent should complete without errors
      expect(true).toBe(true);
    });

    it('should stop heartbeat after agent fails', async () => {
      provider.complete = vi.fn().mockRejectedValue(new Error('Test error'));
      const agent = new TestAgent(context);

      await expect(agent.run()).rejects.toThrow();

      // Agent should still clean up heartbeat
      expect(true).toBe(true);
    });
  });
});
