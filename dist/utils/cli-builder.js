/**
 * CLI Command Builder
 * Generates appropriate CLI commands for spawning agents based on configured tool and model
 */
export function buildCLICommand(config) {
    const cliTool = config.cliTool || 'claude';
    switch (cliTool) {
        case 'claude':
            return buildClaudeCLICommand(config.model, config.permissions);
        case 'codex':
            return buildCodexCLICommand(config.model, config.permissions);
        case 'gemini':
            return buildGeminiCLICommand(config.model, config.permissions);
        default:
            throw new Error(`Unknown CLI tool: ${cliTool}`);
    }
}
function buildClaudeCLICommand(model, permissions) {
    const parts = ['claude'];
    if (permissions === 'dangerously-skip-permissions') {
        parts.push('--dangerously-skip-permissions');
    }
    parts.push('--model', model);
    return parts.join(' ');
}
function buildCodexCLICommand(model, permissions) {
    const parts = ['codex'];
    if (permissions === 'dangerously-skip-permissions') {
        parts.push('--skip-permissions');
    }
    parts.push('--model', model);
    return parts.join(' ');
}
function buildGeminiCLICommand(model, permissions) {
    const parts = ['gemini'];
    if (permissions === 'dangerously-skip-permissions') {
        parts.push('--allow-unsafe-operations');
    }
    parts.push('--model', model);
    return parts.join(' ');
}
export function getModelForAgentType(agentType, modelsConfig) {
    const modelConfig = modelsConfig[agentType];
    if (!modelConfig) {
        throw new Error(`No model configuration found for agent type: ${agentType}`);
    }
    return modelConfig.model;
}
export function buildAgentSpawnCommand(agentType, modelsConfig, options) {
    const model = getModelForAgentType(agentType, modelsConfig);
    return buildCLICommand({
        agentType,
        model,
        cliTool: options?.cliTool,
        permissions: options?.skipPermissions ? 'dangerously-skip-permissions' : undefined,
    });
}
//# sourceMappingURL=cli-builder.js.map