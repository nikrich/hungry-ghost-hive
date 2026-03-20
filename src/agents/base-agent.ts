// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../db/provider.js';
import {
  updateAgent,
  type AgentRow,
  type AgentStatus,
  type AgentType,
} from '../db/queries/agents.js';
import { updateAgentHeartbeat } from '../db/queries/heartbeat.js';
import { createLog, type EventType } from '../db/queries/logs.js';
import { recordTokenUsage } from '../db/queries/token-usage.js';
import type { LLMProvider, Message } from '../llm/provider.js';
import { findHiveRoot, getHivePaths } from '../utils/paths.js';

/** Interval in ms between agent heartbeats */
const HEARTBEAT_INTERVAL_MS = 10000;

/** Interval in ms between periodic token usage captures */
const PERIODIC_TOKEN_CAPTURE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
  db: DatabaseProvider;
  provider: LLMProvider;
  agentRow: AgentRow;
  workDir: string;
  config: {
    maxRetries: number;
    checkpointThreshold: number;
    pollInterval: number;
    llmTimeoutMs: number;
    llmMaxRetries: number;
  };
}

export abstract class BaseAgent {
  protected db: DatabaseProvider;
  protected provider: LLMProvider;
  protected agentId: string;
  protected agentType: AgentType;
  protected teamId: string | null;
  protected workDir: string;
  protected storiesDir: string | undefined;
  protected config: AgentContext['config'];
  protected messages: Message[] = [];
  protected memoryState: MemoryState;
  protected totalTokens = 0;
  protected inputTokens = 0;
  protected outputTokens = 0;
  private readonly model: string | null;
  private readonly sessionId: string | null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private periodicTokenCaptureInterval: NodeJS.Timeout | null = null;
  private lastPersistedInputTokens = 0;
  private lastPersistedOutputTokens = 0;

  constructor(context: AgentContext) {
    this.db = context.db;
    this.provider = context.provider;
    this.agentId = context.agentRow.id;
    this.agentType = context.agentRow.type;
    this.teamId = context.agentRow.team_id;
    this.workDir = context.workDir;
    this.config = context.config;
    this.model = context.agentRow.model ?? null;
    this.sessionId = context.agentRow.tmux_session ?? null;

    const hiveRoot = findHiveRoot(context.workDir);
    this.storiesDir = hiveRoot ? getHivePaths(hiveRoot).storiesDir : undefined;

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
    this.messages = [{ role: 'system', content: this.getSystemPrompt() }];

    // Add memory context if resuming
    if (this.memoryState.conversationSummary) {
      this.messages.push({
        role: 'user',
        content: `Previous context:\n${this.memoryState.conversationSummary}\n\nContinue from where you left off.`,
      });
    }

    // Start heartbeat mechanism for faster failure detection
    this.startHeartbeat();

    // Start periodic token capture to avoid losing usage data on long-running sessions
    this.startPeriodicTokenCapture();
  }

  abstract getSystemPrompt(): string;

  private startHeartbeat(): void {
    // Send initial heartbeat
    this.sendHeartbeat();

    // Send heartbeat at configured interval
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      await updateAgentHeartbeat(this.db, this.agentId);
    } catch (err) {
      // Heartbeat failure shouldn't crash the agent
      console.error(`Heartbeat failed for ${this.agentId}:`, err);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startPeriodicTokenCapture(): void {
    this.periodicTokenCaptureInterval = setInterval(() => {
      void this.persistTokenUsage();
    }, PERIODIC_TOKEN_CAPTURE_INTERVAL_MS);
  }

  private stopPeriodicTokenCapture(): void {
    if (this.periodicTokenCaptureInterval) {
      clearInterval(this.periodicTokenCaptureInterval);
      this.periodicTokenCaptureInterval = null;
    }
  }

  protected async log(
    eventType: EventType,
    message?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await createLog(this.db, {
      agentId: this.agentId,
      storyId: this.memoryState.currentTask?.storyId,
      eventType,
      message,
      metadata,
    });
  }

  protected async updateStatus(status: AgentStatus): Promise<void> {
    await updateAgent(this.db, this.agentId, { status });
  }

  protected async saveMemoryState(): Promise<void> {
    this.memoryState.checkpointTokens = this.totalTokens;
    await updateAgent(this.db, this.agentId, {
      memoryState: JSON.stringify(this.memoryState),
    });
  }

  protected async chat(userMessage: string): Promise<string> {
    this.messages.push({ role: 'user', content: userMessage });

    try {
      // Apply configured timeout to LLM call
      const result = await this.provider.complete(this.messages, {
        timeoutMs: this.config.llmTimeoutMs,
      });

      this.inputTokens += result.usage.inputTokens;
      this.outputTokens += result.usage.outputTokens;
      this.totalTokens += result.usage.inputTokens + result.usage.outputTokens;
      this.messages.push({ role: 'assistant', content: result.content });

      // Check if we need to checkpoint
      if (this.totalTokens > this.config.checkpointThreshold) {
        await this.checkpoint();
      }

      return result.content;
    } catch (err) {
      // Log timeout/error event
      await this.log(
        'AGENT_TERMINATED',
        `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          error: err instanceof Error ? err.stack : String(err),
        }
      );
      throw err;
    }
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
    await this.saveMemoryState();

    await this.log('AGENT_CHECKPOINT', 'Checkpoint saved', {
      totalTokens: this.totalTokens,
    });

    await this.persistTokenUsage();

    // Reset messages but keep context
    this.messages = [
      { role: 'system', content: this.getSystemPrompt() },
      {
        role: 'user',
        content: `Previous context:\n${this.memoryState.conversationSummary}\n\nContinue from where you left off.`,
      },
    ];
    this.totalTokens = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.lastPersistedInputTokens = 0;
    this.lastPersistedOutputTokens = 0;
  }

  private async persistTokenUsage(): Promise<void> {
    const deltaInput = this.inputTokens - this.lastPersistedInputTokens;
    const deltaOutput = this.outputTokens - this.lastPersistedOutputTokens;
    const deltaTotal = deltaInput + deltaOutput;
    if (deltaTotal === 0) return;
    try {
      await recordTokenUsage(this.db, {
        agentId: this.agentId,
        storyId: this.memoryState.currentTask?.storyId ?? null,
        inputTokens: deltaInput,
        outputTokens: deltaOutput,
        totalTokens: deltaTotal,
        model: this.model,
        sessionId: this.sessionId,
      });
      this.lastPersistedInputTokens = this.inputTokens;
      this.lastPersistedOutputTokens = this.outputTokens;
    } catch (err) {
      // Token persistence failure should not crash the agent
      console.error(`Failed to persist token usage for ${this.agentId}:`, err);
    }
  }

  protected async addDecision(decision: string): Promise<void> {
    this.memoryState.context.decisionsMade.push(decision);
    await this.saveMemoryState();
  }

  protected async addBlocker(blocker: string): Promise<void> {
    this.memoryState.context.blockers.push(blocker);
    await this.saveMemoryState();
  }

  protected async removeBlocker(blocker: string): Promise<void> {
    this.memoryState.context.blockers = this.memoryState.context.blockers.filter(
      b => b !== blocker
    );
    await this.saveMemoryState();
  }

  protected async setCurrentTask(storyId: string, phase: string): Promise<void> {
    this.memoryState.currentTask = {
      storyId,
      phase,
      filesModified: [],
      lastAction: '',
    };
    await this.saveMemoryState();
  }

  protected async updateTaskProgress(lastAction: string, filesModified?: string[]): Promise<void> {
    if (this.memoryState.currentTask) {
      this.memoryState.currentTask.lastAction = lastAction;
      if (filesModified) {
        this.memoryState.currentTask.filesModified.push(...filesModified);
      }
      await this.saveMemoryState();
    }
  }

  async run(): Promise<void> {
    await this.updateStatus('working');
    await this.log('AGENT_SPAWNED', `${this.agentType} agent started`);

    try {
      await this.execute();
      await this.persistTokenUsage();
    } catch (err) {
      await this.persistTokenUsage();
      await this.updateStatus('blocked');
      await this.log(
        'AGENT_TERMINATED',
        `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        {
          error: err instanceof Error ? err.stack : String(err),
        }
      );
      throw err;
    } finally {
      // Stop heartbeat and periodic token capture when agent completes or fails
      this.stopHeartbeat();
      this.stopPeriodicTokenCapture();
    }
  }

  abstract execute(): Promise<void>;
}
