import type { Database } from 'sql.js';
import type { LLMProvider, Message } from '../llm/provider.js';
import { type EventType } from '../db/queries/logs.js';
import { type AgentRow, type AgentType, type AgentStatus } from '../db/queries/agents.js';
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
        llmTimeoutMs: number;
        llmMaxRetries: number;
    };
}
export declare abstract class BaseAgent {
    protected db: Database;
    protected provider: LLMProvider;
    protected agentId: string;
    protected agentType: AgentType;
    protected teamId: string | null;
    protected workDir: string;
    protected config: AgentContext['config'];
    protected messages: Message[];
    protected memoryState: MemoryState;
    protected totalTokens: number;
    private heartbeatInterval;
    constructor(context: AgentContext);
    abstract getSystemPrompt(): string;
    private startHeartbeat;
    private sendHeartbeat;
    private stopHeartbeat;
    protected log(eventType: EventType, message?: string, metadata?: Record<string, unknown>): void;
    protected updateStatus(status: AgentStatus): void;
    protected saveMemoryState(): void;
    protected chat(userMessage: string): Promise<string>;
    protected checkpoint(): Promise<void>;
    protected addDecision(decision: string): void;
    protected addBlocker(blocker: string): void;
    protected removeBlocker(blocker: string): void;
    protected setCurrentTask(storyId: string, phase: string): void;
    protected updateTaskProgress(lastAction: string, filesModified?: string[]): void;
    run(): Promise<void>;
    abstract execute(): Promise<void>;
}
//# sourceMappingURL=base-agent.d.ts.map