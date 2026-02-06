/**
 * CLI Command Builder
 * Generates appropriate CLI commands for spawning agents based on configured tool and model
 */

import type { ModelsConfig } from '../config/schema.js';

export type AgentType = 'senior' | 'intermediate' | 'junior' | 'qa';

export interface CLICommandConfig {
  agentType: AgentType;
  model: string;
  cliTool?: string; // 'claude' (default), 'codex', 'gemini', etc.
  permissions?: 'dangerously-skip-permissions';
}

/**
 * Build a CLI command to spawn an agent
 * Currently supports Claude Code CLI. Will be extended for Codex and Gemini in future stories.
 */
export function buildCLICommand(config: CLICommandConfig): string {
  const cliTool = config.cliTool || 'claude';

  // Build command based on CLI tool
  switch (cliTool) {
    case 'claude':
      return buildClaudeCLICommand(config.model, config.permissions);
    case 'codex':
      // TODO: Implement in future story (MC004-MC005)
      throw new Error('Codex CLI support not yet implemented');
    case 'gemini':
      // TODO: Implement in future story (MC004-MC005)
      throw new Error('Gemini CLI support not yet implemented');
    default:
      throw new Error(`Unknown CLI tool: ${cliTool}`);
  }
}

/**
 * Build a Claude Code CLI command
 */
function buildClaudeCLICommand(model: string, permissions?: string): string {
  const parts = ['claude'];

  if (permissions === 'dangerously-skip-permissions') {
    parts.push('--dangerously-skip-permissions');
  }

  parts.push('--model', model);

  return parts.join(' ');
}

/**
 * Get the appropriate model for an agent type from config
 */
export function getModelForAgentType(
  agentType: AgentType,
  modelsConfig: ModelsConfig,
): string {
  const modelConfig = modelsConfig[agentType];
  if (!modelConfig) {
    throw new Error(`No model configuration found for agent type: ${agentType}`);
  }
  return modelConfig.model;
}

/**
 * Build a CLI command for spawning a specific agent type
 * This is the main entry point for the scheduler
 */
export function buildAgentSpawnCommand(
  agentType: AgentType,
  modelsConfig: ModelsConfig,
  options?: {
    cliTool?: string;
    skipPermissions?: boolean;
  },
): string {
  const model = getModelForAgentType(agentType, modelsConfig);

  return buildCLICommand({
    agentType,
    model,
    cliTool: options?.cliTool,
    permissions: options?.skipPermissions ? 'dangerously-skip-permissions' : undefined,
  });
}
