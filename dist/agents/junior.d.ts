import { BaseAgent, type AgentContext } from './base-agent.js';
export interface JuniorContext extends AgentContext {
    storyId?: string;
}
export declare class JuniorAgent extends BaseAgent {
    private team;
    private story;
    private retryCount;
    constructor(context: JuniorContext);
    getSystemPrompt(): string;
    execute(): Promise<void>;
    private implementStory;
    private escalateToSenior;
}
//# sourceMappingURL=junior.d.ts.map