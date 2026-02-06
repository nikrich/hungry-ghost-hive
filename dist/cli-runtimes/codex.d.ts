import { CliRuntimeBuilder } from './types.js';
export declare class CodexRuntimeBuilder implements CliRuntimeBuilder {
    buildSpawnCommand(model: string): string[];
    buildResumeCommand(model: string, sessionId: string): string[];
    getAutoApprovalFlag(): string;
    getModelFlag(): string;
}
//# sourceMappingURL=codex.d.ts.map