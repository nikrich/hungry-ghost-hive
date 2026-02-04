import { createLog } from '../db/queries/logs.js';
import { updateAgent } from '../db/queries/agents.js';
export class BaseAgent {
    db;
    provider;
    agentId;
    agentType;
    teamId;
    workDir;
    config;
    messages = [];
    memoryState;
    totalTokens = 0;
    constructor(context) {
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
        }
        else {
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
    log(eventType, message, metadata) {
        createLog(this.db, {
            agentId: this.agentId,
            storyId: this.memoryState.currentTask?.storyId,
            eventType,
            message,
            metadata,
        });
    }
    updateStatus(status) {
        updateAgent(this.db, this.agentId, { status });
    }
    saveMemoryState() {
        this.memoryState.checkpointTokens = this.totalTokens;
        updateAgent(this.db, this.agentId, {
            memoryState: JSON.stringify(this.memoryState),
        });
    }
    async chat(userMessage) {
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
    async checkpoint() {
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
    addDecision(decision) {
        this.memoryState.context.decisionsMade.push(decision);
        this.saveMemoryState();
    }
    addBlocker(blocker) {
        this.memoryState.context.blockers.push(blocker);
        this.saveMemoryState();
    }
    removeBlocker(blocker) {
        this.memoryState.context.blockers = this.memoryState.context.blockers.filter(b => b !== blocker);
        this.saveMemoryState();
    }
    setCurrentTask(storyId, phase) {
        this.memoryState.currentTask = {
            storyId,
            phase,
            filesModified: [],
            lastAction: '',
        };
        this.saveMemoryState();
    }
    updateTaskProgress(lastAction, filesModified) {
        if (this.memoryState.currentTask) {
            this.memoryState.currentTask.lastAction = lastAction;
            if (filesModified) {
                this.memoryState.currentTask.filesModified.push(...filesModified);
            }
            this.saveMemoryState();
        }
    }
    async run() {
        this.updateStatus('working');
        this.log('AGENT_SPAWNED', `${this.agentType} agent started`);
        try {
            await this.execute();
        }
        catch (err) {
            this.updateStatus('blocked');
            this.log('AGENT_TERMINATED', `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, {
                error: err instanceof Error ? err.stack : String(err),
            });
            throw err;
        }
    }
}
//# sourceMappingURL=base-agent.js.map