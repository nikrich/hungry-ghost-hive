import { BaseAgent, type AgentContext } from './base-agent.js';
export interface TechLeadContext extends AgentContext {
    requirementId?: string;
}
export declare class TechLeadAgent extends BaseAgent {
    private teams;
    private requirementId?;
    private requirement?;
    constructor(context: TechLeadContext);
    getSystemPrompt(): string;
    execute(): Promise<void>;
    private analyzeRequirement;
    private createStories;
    private coordinateWithSeniors;
    private escalateToHuman;
}
//# sourceMappingURL=tech-lead.d.ts.map