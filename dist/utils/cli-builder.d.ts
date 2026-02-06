/**
 * CLI Command Builder
 * Generates appropriate CLI commands for spawning agents based on configured tool and model
 */
import type { ModelsConfig } from '../config/schema.js';
export type AgentType = 'senior' | 'intermediate' | 'junior' | 'qa' | 'tech_lead';
export interface CLICommandConfig {
    agentType: AgentType;
    model: string;
    cliTool?: string;
    permissions?: 'dangerously-skip-permissions';
}
export declare function buildCLICommand(config: CLICommandConfig): string;
export declare function getModelForAgentType(agentType: AgentType, modelsConfig: ModelsConfig): string;
export declare function buildAgentSpawnCommand(agentType: AgentType, modelsConfig: ModelsConfig, options?: {
    cliTool?: string;
    skipPermissions?: boolean;
}): string;
//# sourceMappingURL=cli-builder.d.ts.map