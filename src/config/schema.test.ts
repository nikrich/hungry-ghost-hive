import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, HiveConfigSchema } from './schema.js';

describe('HiveConfigSchema', () => {
  it('should validate default config', () => {
    const result = HiveConfigSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });

  it('should accept valid config with cli_tool', () => {
    const config = {
      version: '1.0',
      models: {
        tech_lead: {
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          max_tokens: 16000,
          temperature: 0.7,
          cli_tool: 'claude',
        },
        senior: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8000,
          temperature: 0.5,
          cli_tool: 'claude',
        },
        intermediate: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          temperature: 0.3,
          cli_tool: 'claude',
        },
        junior: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          max_tokens: 4000,
          temperature: 0.2,
          cli_tool: 'codex',
        },
        qa: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8000,
          temperature: 0.2,
          cli_tool: 'claude',
        },
      },
      scaling: {
        senior_capacity: 20,
        junior_max_complexity: 3,
        intermediate_max_complexity: 5,
      },
      github: {
        base_branch: 'main',
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should apply defaults for empty config', () => {
    const result = HiveConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1.0');
      expect(result.data.scaling.senior_capacity).toBe(20);
      expect(result.data.cluster.enabled).toBe(false);
      expect(result.data.cluster.node_id).toBe('node-local');
    }
  });

  it('should reject invalid scaling values', () => {
    const config = {
      scaling: {
        junior_max_complexity: 15, // Invalid: max is 13
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should apply defaults for refactor scaling policy', () => {
    const config = HiveConfigSchema.parse({});
    expect(config.scaling.refactor.enabled).toBe(true);
    expect(config.scaling.refactor.capacity_percent).toBe(10);
    expect(config.scaling.refactor.allow_without_feature_work).toBe(true);
  });

  it('should reject invalid refactor capacity percent', () => {
    const config = {
      scaling: {
        refactor: {
          capacity_percent: 150,
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept all valid cli_tool values (claude, codex, gemini)', () => {
    const tools = ['claude', 'codex', 'gemini'];

    for (const tool of tools) {
      const config = {
        models: {
          junior: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            cli_tool: tool,
          },
        },
      };

      const result = HiveConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid cli_tool values', () => {
    const config = {
      models: {
        junior: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          max_tokens: 4000,
          temperature: 0.2,
          cli_tool: 'invalid_tool',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should apply cli_tool default to all tiers', () => {
    const config = HiveConfigSchema.parse({});
    expect(config.models.tech_lead.cli_tool).toBe('claude');
    expect(config.models.senior.cli_tool).toBe('claude');
    expect(config.models.intermediate.cli_tool).toBe('claude');
    expect(config.models.junior.cli_tool).toBe('codex');
    expect(config.models.qa.cli_tool).toBe('claude');
  });

  it('should export ModelConfig type with cli_tool', () => {
    const config = DEFAULT_CONFIG;
    expect(config.models).toBeDefined();
    expect(config.models.junior.cli_tool).toBe('codex');
    expect(typeof config.models.junior.cli_tool).toBe('string');
  });

  it('should accept valid cluster config with peers', () => {
    const config = {
      cluster: {
        enabled: true,
        node_id: 'node-a',
        listen_host: '0.0.0.0',
        listen_port: 8787,
        public_url: 'http://node-a.example.com:8787',
        peers: [
          { id: 'node-b', url: 'http://node-b.example.com:8787' },
          { id: 'node-c', url: 'http://node-c.example.com:8787' },
        ],
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should reject cluster peers with invalid URLs', () => {
    const config = {
      cluster: {
        enabled: true,
        node_id: 'node-a',
        public_url: 'http://node-a.example.com:8787',
        peers: [{ id: 'node-b', url: 'not-a-url' }],
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
