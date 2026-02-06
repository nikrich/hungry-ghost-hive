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

export function buildCLICommand(config: CLICommandConfig): string {
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

function buildClaudeCLICommand(model: string, permissions?: string): string {
  const parts = ['claude'];
  if (permissions === 'dangerously-skip-permissions') {
    parts.push('--dangerously-skip-permissions');
  }
  parts.push('--model', model);
  return parts.join(' ');
}

function buildCodexCLICommand(model: string, permissions?: string): string {
  const parts = ['codex'];
  if (permissions === 'dangerously-skip-permissions') {
    parts.push('--skip-permissions');
  }
  parts.push('--model', model);
  return parts.join(' ');
}

function buildGeminiCLICommand(model: string, permissions?: string): string {
  const parts = ['gemini'];
  if (permissions === 'dangerously-skip-permissions') {
    parts.push('--allow-unsafe-operations');
  }
  parts.push('--model', model);
  return parts.join(' ');
}

export function getModelForAgentType(agentType: AgentType, modelsConfig: ModelsConfig): string {
  const modelConfig = modelsConfig[agentType];
  if (!modelConfig) {
    throw new Error(`No model configuration found for agent type: ${agentType}`);
  }
  return modelConfig.model;
}

export function buildAgentSpawnCommand(
  agentType: AgentType,
  modelsConfig: ModelsConfig,
  options?: { cliTool?: string; skipPermissions?: boolean }
): string {
  const model = getModelForAgentType(agentType, modelsConfig);
  return buildCLICommand({
    agentType,
    model,
    cliTool: options?.cliTool,
    permissions: options?.skipPermissions ? 'dangerously-skip-permissions' : undefined,
  });
}
