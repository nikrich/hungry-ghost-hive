import { BaseAgent, type AgentContext } from './base-agent.js';
export interface IntermediateContext extends AgentContext {
    storyId?: string;
}
export declare class IntermediateAgent extends BaseAgent {
    private team;
    private story;
    private retryCount;
    constructor(context: IntermediateContext);
    getSystemPrompt(): string;
    execute(): Promise<void>;
    private implementStory;
    private escalateToSenior;
}
//# sourceMappingURL=intermediate.d.ts.map