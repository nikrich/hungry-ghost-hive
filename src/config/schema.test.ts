import { describe, it, expect } from 'vitest';
import { HiveConfigSchema, DEFAULT_CONFIG } from './schema.js';

describe('HiveConfigSchema', () => {
  it('should validate default config', () => {
    const result = HiveConfigSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });

  it('should accept valid config', () => {
    const config = {
      version: '1.0',
      models: {
        tech_lead: {
          provider: 'anthropic',
          model: 'claude-opus-4-20250514',
          max_tokens: 16000,
          temperature: 0.7,
        },
        senior: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          temperature: 0.5,
        },
        intermediate: {
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 4000,
          temperature: 0.3,
        },
        junior: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          max_tokens: 4000,
          temperature: 0.2,
        },
        qa: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          temperature: 0.2,
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
});
