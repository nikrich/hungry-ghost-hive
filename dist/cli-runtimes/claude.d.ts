import { CliRuntimeBuilder } from './types.js';
export declare class ClaudeRuntimeBuilder implements CliRuntimeBuilder {
    buildSpawnCommand(model: string): string[];
    buildResumeCommand(model: string, sessionId: string): string[];
    getAutoApprovalFlag(): string;
    getModelFlag(): string;
}
//# sourceMappingURL=claude.d.ts.map