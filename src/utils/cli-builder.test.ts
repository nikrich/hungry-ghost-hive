import { describe, it, expect } from 'vitest';
import { buildCLICommand, buildAgentSpawnCommand, getModelForAgentType } from './cli-builder.js';
import type { ModelsConfig } from '../config/schema.js';

const mockModelsConfig: ModelsConfig = {
  tech_lead: {
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    max_tokens: 16000,
    temperature: 0.7,
    cli_tool: 'claude',
  },
  senior: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    temperature: 0.5,
    cli_tool: 'claude',
  },
  intermediate: {
    provider: 'anthropic',
    model: 'claude-haiku-3-5-20241022',
    max_tokens: 4000,
    temperature: 0.3,
    cli_tool: 'claude',
  },
  junior: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    max_tokens: 4000,
    temperature: 0.2,
    cli_tool: 'claude',
  },
  qa: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    temperature: 0.2,
    cli_tool: 'claude',
  },
};

describe('CLI Command Builder', () => {
  describe('buildCLICommand', () => {
    it('builds Claude CLI command without permissions', () => {
      const cmd = buildCLICommand({
        agentType: 'senior',
        model: 'claude-sonnet-4-20250514',
        cliTool: 'claude',
      });
      expect(cmd).toBe('claude --model claude-sonnet-4-20250514');
    });

    it('builds Claude CLI command with dangerously-skip-permissions', () => {
      const cmd = buildCLICommand({
        agentType: 'senior',
        model: 'claude-sonnet-4-20250514',
        cliTool: 'claude',
        permissions: 'dangerously-skip-permissions',
      });
      expect(cmd).toBe('claude --dangerously-skip-permissions --model claude-sonnet-4-20250514');
    });

    it('defaults to claude CLI when cliTool is not specified', () => {
      const cmd = buildCLICommand({
        agentType: 'senior',
        model: 'claude-sonnet-4-20250514',
      });
      expect(cmd).toBe('claude --model claude-sonnet-4-20250514');
    });

    it('throws error for unsupported CLI tools', () => {
      expect(() =>
        buildCLICommand({
          agentType: 'senior',
          model: 'claude-sonnet-4-20250514',
          cliTool: 'unsupported',
        }),
      ).toThrow('Unknown CLI tool: unsupported');
    });

    it('throws error for Codex CLI (not yet implemented)', () => {
      expect(() =>
        buildCLICommand({
          agentType: 'senior',
          model: 'claude-sonnet-4-20250514',
          cliTool: 'codex',
        }),
      ).toThrow('Codex CLI support not yet implemented');
    });

    it('throws error for Gemini CLI (not yet implemented)', () => {
      expect(() =>
        buildCLICommand({
          agentType: 'senior',
          model: 'claude-sonnet-4-20250514',
          cliTool: 'gemini',
        }),
      ).toThrow('Gemini CLI support not yet implemented');
    });
  });

  describe('getModelForAgentType', () => {
    it('returns the correct model for senior', () => {
      const model = getModelForAgentType('senior', mockModelsConfig);
      expect(model).toBe('claude-sonnet-4-20250514');
    });

    it('returns the correct model for intermediate', () => {
      const model = getModelForAgentType('intermediate', mockModelsConfig);
      expect(model).toBe('claude-haiku-3-5-20241022');
    });

    it('returns the correct model for junior', () => {
      const model = getModelForAgentType('junior', mockModelsConfig);
      expect(model).toBe('gpt-4o-mini');
    });

    it('returns the correct model for qa', () => {
      const model = getModelForAgentType('qa', mockModelsConfig);
      expect(model).toBe('claude-sonnet-4-20250514');
    });

    it('throws error for unknown agent type', () => {
      expect(() => getModelForAgentType('unknown' as any, mockModelsConfig)).toThrow(
        'No model configuration found for agent type: unknown',
      );
    });
  });

  describe('buildAgentSpawnCommand', () => {
    it('builds spawn command for senior with default options', () => {
      const cmd = buildAgentSpawnCommand('senior', mockModelsConfig);
      expect(cmd).toBe('claude --model claude-sonnet-4-20250514');
    });

    it('builds spawn command for senior with skip permissions', () => {
      const cmd = buildAgentSpawnCommand('senior', mockModelsConfig, {
        skipPermissions: true,
      });
      expect(cmd).toBe('claude --dangerously-skip-permissions --model claude-sonnet-4-20250514');
    });

    it('builds spawn command for intermediate', () => {
      const cmd = buildAgentSpawnCommand('intermediate', mockModelsConfig, {
        skipPermissions: true,
      });
      expect(cmd).toBe('claude --dangerously-skip-permissions --model claude-haiku-3-5-20241022');
    });

    it('builds spawn command for qa', () => {
      const cmd = buildAgentSpawnCommand('qa', mockModelsConfig, {
        skipPermissions: true,
      });
      expect(cmd).toBe('claude --dangerously-skip-permissions --model claude-sonnet-4-20250514');
    });

    it('respects custom cliTool option', () => {
      // This will throw because Codex is not implemented yet, but it shows the option is passed through
      expect(() =>
        buildAgentSpawnCommand('senior', mockModelsConfig, {
          cliTool: 'codex',
          skipPermissions: true,
        }),
      ).toThrow('Codex CLI support not yet implemented');
    });
  });
});
