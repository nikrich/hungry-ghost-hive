import type { Database } from 'sql.js';
import type { LLMProvider, Message } from '../llm/provider.js';
import { createLog, type EventType } from '../db/queries/logs.js';
import { updateAgent, type AgentRow, type AgentType, type AgentStatus } from '../db/queries/agents.js';

export interface MemoryState {
  conversationSummary: string;
  currentTask?: {
    storyId?: string;
    phase: string;
    filesModified: string[];
    lastAction: string;
  };
  context: {
    codebaseNotes?: string;
    blockers: string[];
    decisionsMade: string[];
  };
  checkpointTokens: number;
}

export interface AgentContext {
  db: Database;
  provider: LLMProvider;
  agentRow: AgentRow;
  workDir: string;
  config: {
    maxRetries: number;
    checkpointThreshold: number;
    pollInterval: number;
  };
}

export abstract class BaseAgent {
  protected db: Database;
  protected provider: LLMProvider;
  protected agentId: string;
  protected agentType: AgentType;
  protected teamId: string | null;
  protected workDir: string;
  protected config: AgentContext['config'];
  protected messages: Message[] = [];
  protected memoryState: MemoryState;
  protected totalTokens = 0;

  constructor(context: AgentContext) {
    this.db = context.db;
    this.provider = context.provider;
    this.agentId = context.agentRow.id;
    this.agentType = context.agentRow.type;
    this.teamId = context.agentRow.team_id;
    this.workDir = context.workDir;
    this.config = context.config;

    // Load or initialize memory state
    if (context.agentRow.memory_state) {
      this.memoryState = JSON.parse(context.agentRow.memory_state);
    } else {
      this.memoryState = {
        conversationSummary: '',
        context: {
          blockers: [],
          decisionsMade: [],
        },
        checkpointTokens: 0,
      };
    }

    // Initialize messages with system prompt
    this.messages = [
      { role: 'system', content: this.getSystemPrompt() },
    ];

    // Add memory context if resuming
    if (this.memoryState.conversationSummary) {
      this.messages.push({
        role: 'user',
        content: `Previous context:\n${this.memoryState.conversationSummary}\n\nContinue from where you left off.`,
      });
    }
  }

  abstract getSystemPrompt(): string;

  protected log(
    eventType: EventType,
    message?: string,
    metadata?: Record<string, unknown>
  ): void {
    createLog(this.db, {
      agentId: this.agentId,
      storyId: this.memoryState.currentTask?.storyId,
      eventType,
      message,
      metadata,
    });
  }

  protected updateStatus(status: AgentStatus): void {
    updateAgent(this.db, this.agentId, { status });
  }

  protected saveMemoryState(): void {
    this.memoryState.checkpointTokens = this.totalTokens;
    updateAgent(this.db, this.agentId, {
      memoryState: JSON.stringify(this.memoryState),
    });
  }

  protected async chat(userMessage: string): Promise<string> {
    this.messages.push({ role: 'user', content: userMessage });

    const result = await this.provider.complete(this.messages);
    this.totalTokens += result.usage.inputTokens + result.usage.outputTokens;

    this.messages.push({ role: 'assistant', content: result.content });

    // Check if we need to checkpoint
    if (this.totalTokens > this.config.checkpointThreshold) {
      await this.checkpoint();
    }

    return result.content;
  }

  protected async checkpoint(): Promise<void> {
    // Summarize the conversation
    const summaryPrompt = `Summarize the key points of our conversation so far in a concise paragraph. Focus on:
1. What task we're working on
2. What progress has been made
3. What decisions were made
4. What blockers or issues exist
5. What's the next step

Keep it under 500 words.`;

    this.messages.push({ role: 'user', content: summaryPrompt });
    const summaryResult = await this.provider.complete(this.messages);

    this.memoryState.conversationSummary = summaryResult.content;
    this.saveMemoryState();

    this.log('AGENT_CHECKPOINT', 'Checkpoint saved', {
      totalTokens: this.totalTokens,
    });

    // Reset messages but keep context
    this.messages = [
      { role: 'system', content: this.getSystemPrompt() },
      { role: 'user', content: `Previous context:\n${this.memoryState.conversationSummary}\n\nContinue from where you left off.` },
    ];
    this.totalTokens = 0;
  }

  protected addDecision(decision: string): void {
    this.memoryState.context.decisionsMade.push(decision);
    this.saveMemoryState();
  }

  protected addBlocker(blocker: string): void {
    this.memoryState.context.blockers.push(blocker);
    this.saveMemoryState();
  }

  protected removeBlocker(blocker: string): void {
    this.memoryState.context.blockers = this.memoryState.context.blockers.filter(
      b => b !== blocker
    );
    this.saveMemoryState();
  }

  protected setCurrentTask(storyId: string, phase: string): void {
    this.memoryState.currentTask = {
      storyId,
      phase,
      filesModified: [],
      lastAction: '',
    };
    this.saveMemoryState();
  }

  protected updateTaskProgress(lastAction: string, filesModified?: string[]): void {
    if (this.memoryState.currentTask) {
      this.memoryState.currentTask.lastAction = lastAction;
      if (filesModified) {
        this.memoryState.currentTask.filesModified.push(...filesModified);
      }
      this.saveMemoryState();
    }
  }

  async run(): Promise<void> {
    this.updateStatus('working');
    this.log('AGENT_SPAWNED', `${this.agentType} agent started`);

    try {
      await this.execute();
    } catch (err) {
      this.updateStatus('blocked');
      this.log('AGENT_TERMINATED', `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, {
        error: err instanceof Error ? err.stack : String(err),
      });
      throw err;
    }
  }

  abstract execute(): Promise<void>;
}
