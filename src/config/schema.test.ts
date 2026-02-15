// Licensed under the Hungry Ghost Hive License. See LICENSE.

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
          safety_mode: 'unsafe',
        },
        senior: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8000,
          temperature: 0.5,
          cli_tool: 'claude',
          safety_mode: 'safe',
        },
        intermediate: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          temperature: 0.3,
          cli_tool: 'claude',
          safety_mode: 'unsafe',
        },
        junior: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8000,
          temperature: 0.3,
          cli_tool: 'claude',
          safety_mode: 'unsafe',
        },
        qa: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8000,
          temperature: 0.2,
          cli_tool: 'claude',
          safety_mode: 'safe',
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
      expect(result.data.cluster.listen_host).toBe('127.0.0.1');
      expect(result.data.manager.completion_classifier.model).toBe('gpt-5.2-codex');
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
    expect(config.models.junior.cli_tool).toBe('claude');
    expect(config.models.qa.cli_tool).toBe('claude');
  });

  it('should apply safety_mode default to all tiers', () => {
    const config = HiveConfigSchema.parse({});
    expect(config.models.tech_lead.safety_mode).toBe('unsafe');
    expect(config.models.senior.safety_mode).toBe('unsafe');
    expect(config.models.intermediate.safety_mode).toBe('unsafe');
    expect(config.models.junior.safety_mode).toBe('unsafe');
    expect(config.models.qa.safety_mode).toBe('unsafe');
  });

  it('should accept valid safety_mode values', () => {
    const safeConfig = {
      models: {
        junior: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          cli_tool: 'codex',
          safety_mode: 'safe',
        },
      },
    };
    const unsafeConfig = {
      models: {
        junior: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          cli_tool: 'codex',
          safety_mode: 'unsafe',
        },
      },
    };

    expect(HiveConfigSchema.safeParse(safeConfig).success).toBe(true);
    expect(HiveConfigSchema.safeParse(unsafeConfig).success).toBe(true);
  });

  it('should reject invalid safety_mode values', () => {
    const config = {
      models: {
        junior: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          cli_tool: 'codex',
          safety_mode: 'dangerous',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should export ModelConfig type with cli_tool', () => {
    const config = DEFAULT_CONFIG;
    expect(config.models).toBeDefined();
    expect(config.models.junior.cli_tool).toBe('claude');
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
        auth_token: 'secret-token',
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

  it('should reject non-loopback cluster listen_host without auth token when enabled', () => {
    const config = {
      cluster: {
        enabled: true,
        listen_host: '0.0.0.0',
        public_url: 'http://node-a.example.com:8787',
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should allow enabled loopback cluster listen_host without auth token', () => {
    const config = {
      cluster: {
        enabled: true,
        listen_host: '127.0.0.1',
        public_url: 'http://127.0.0.1:8787',
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should accept valid integrations config with source_control', () => {
    const config = {
      integrations: {
        source_control: {
          provider: 'github',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrations.source_control.provider).toBe('github');
    }
  });

  it('should accept valid source_control providers (github, bitbucket, gitlab)', () => {
    const providers = ['github', 'bitbucket', 'gitlab'];

    for (const provider of providers) {
      const config = {
        integrations: {
          source_control: {
            provider: provider as any,
          },
        },
      };

      const result = HiveConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should accept any source_control provider string', () => {
    const config = {
      integrations: {
        source_control: {
          provider: 'custom_provider',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrations.source_control.provider).toBe('custom_provider');
    }
  });

  it('should apply default source_control provider (github)', () => {
    const config = HiveConfigSchema.parse({
      integrations: {
        source_control: {},
      },
    });
    expect(config.integrations.source_control.provider).toBe('github');
  });

  it('should accept valid project_management providers (none, jira)', () => {
    const providers = ['none', 'jira'];

    for (const provider of providers) {
      const config = {
        integrations: {
          project_management: {
            provider: provider as any,
          },
        },
      };

      const result = HiveConfigSchema.safeParse(config);
      // jira requires jira config, so skip that one
      if (provider === 'jira') {
        expect(result.success).toBe(false);
      } else {
        expect(result.success).toBe(true);
      }
    }
  });

  it('should accept any project_management provider string', () => {
    const config = {
      integrations: {
        project_management: {
          provider: 'linear',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrations.project_management.provider).toBe('linear');
    }
  });

  it('should apply default project_management provider (none)', () => {
    const config = HiveConfigSchema.parse({
      integrations: {
        project_management: {},
      },
    });
    expect(config.integrations.project_management.provider).toBe('none');
  });

  it('should require jira config when project_management provider is jira', () => {
    const config = {
      integrations: {
        project_management: {
          provider: 'jira',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept jira configuration with all required fields', () => {
    const config = {
      integrations: {
        project_management: {
          provider: 'jira',
          jira: {
            project_key: 'HIVE',
            site_url: 'https://mycompany.atlassian.net',
          },
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrations.project_management.jira?.project_key).toBe('HIVE');
      expect(result.data.integrations.project_management.jira?.site_url).toBe(
        'https://mycompany.atlassian.net'
      );
      expect(result.data.integrations.project_management.jira?.board_id).toBeUndefined();
    }
  });

  it('should apply jira config defaults for story_type and subtask_type', () => {
    const config = HiveConfigSchema.parse({
      integrations: {
        project_management: {
          provider: 'jira',
          jira: {
            project_key: 'HIVE',
            site_url: 'https://mycompany.atlassian.net',
          },
        },
      },
    });
    expect(config.integrations.project_management.jira?.story_type).toBe('Story');
    expect(config.integrations.project_management.jira?.subtask_type).toBe('Subtask');
  });

  it('should apply defaults for integrations when not specified', () => {
    const config = HiveConfigSchema.parse({});
    expect(config.integrations.source_control.provider).toBe('github');
    expect(config.integrations.project_management.provider).toBe('none');
    expect(config.integrations.autonomy.level).toBe('full');
  });

  it('should accept valid autonomy levels (full, partial)', () => {
    const levels = ['full', 'partial'];

    for (const level of levels) {
      const config = {
        integrations: {
          autonomy: {
            level: level as any,
          },
        },
      };

      const result = HiveConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid autonomy level', () => {
    const config = {
      integrations: {
        autonomy: {
          level: 'unlimited',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should apply default autonomy level (full)', () => {
    const config = HiveConfigSchema.parse({
      integrations: {
        autonomy: {},
      },
    });
    expect(config.integrations.autonomy.level).toBe('full');
  });

  it('should accept complete integrations config with all sections', () => {
    const config = {
      integrations: {
        source_control: {
          provider: 'bitbucket',
        },
        project_management: {
          provider: 'jira',
          jira: {
            project_key: 'HIVE',
            site_url: 'https://mycompany.atlassian.net',
            story_type: 'Feature',
            subtask_type: 'Sub-task',
            status_mapping: {
              'To Do': 'draft',
              'In Progress': 'in_progress',
              Done: 'merged',
            },
          },
        },
        autonomy: {
          level: 'partial',
        },
      },
    };

    const result = HiveConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.integrations.source_control.provider).toBe('bitbucket');
      expect(result.data.integrations.project_management.provider).toBe('jira');
      expect(result.data.integrations.project_management.jira?.project_key).toBe('HIVE');
      expect(result.data.integrations.autonomy.level).toBe('partial');
    }
  });
});
