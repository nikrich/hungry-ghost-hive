import { CliRuntimeBuilder } from './types.js';
export declare class GeminiRuntimeBuilder implements CliRuntimeBuilder {
    buildSpawnCommand(model: string): string[];
    buildResumeCommand(model: string, sessionId: string): string[];
    getAutoApprovalFlag(): string;
    getModelFlag(): string;
}
//# sourceMappingURL=gemini.d.ts.map