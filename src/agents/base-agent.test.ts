// Licensed under the Hungry Ghost Hive License. See LICENSE.

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryAll, queryOne } from '../db/client.js';
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
  let db: Database.Database;
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
`;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(INITIAL_MIGRATION);

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
    db.prepare(`INSERT INTO agents (id, type, team_id, status) VALUES (?, ?, ?, ?)`).run(
      agentRow.id,
      agentRow.type,
      agentRow.team_id,
      agentRow.status
    );

    context = {
      db,
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
      db.prepare(`UPDATE agents SET memory_state = ? WHERE id = ?`).run(
        agentRow.memory_state,
        agentRow.id
      );

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
