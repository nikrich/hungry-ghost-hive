import { BaseAgent, type AgentContext } from './base-agent.js';
export interface SeniorContext extends AgentContext {
    teamId: string;
}
export declare class SeniorAgent extends BaseAgent {
    private team;
    private assignedStories;
    constructor(context: SeniorContext);
    getSystemPrompt(): string;
    execute(): Promise<void>;
    private analyzeCodebase;
    private processStory;
    private delegateStory;
    private implementStory;
    private reviewStory;
    escalateToTechLead(reason: string): Promise<void>;
}
//# sourceMappingURL=senior.d.ts.map