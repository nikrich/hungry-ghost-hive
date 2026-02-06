import { BaseAgent, type AgentContext } from './base-agent.js';
export interface QAContext extends AgentContext {
    qaConfig: {
        qualityChecks: string[];
        buildCommand: string;
        testCommand?: string;
    };
}
export declare class QAAgent extends BaseAgent {
    private team;
    private qaConfig;
    private pendingStories;
    constructor(context: QAContext);
    getSystemPrompt(): string;
    execute(): Promise<void>;
    private processStory;
    private runQualityChecks;
    private runBuild;
    private runTests;
    private createPR;
    private generatePRBody;
}
//# sourceMappingURL=qa.d.ts.map