import { z } from 'zod';

// Model configuration for each agent type
const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: z.string(),
  max_tokens: z.number().int().positive().default(8000),
  temperature: z.number().min(0).max(2).default(0.5),
});

// Models configuration for all agent types
const ModelsConfigSchema = z.object({
  tech_lead: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    max_tokens: 16000,
    temperature: 0.7,
  }),
  senior: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    temperature: 0.5,
  }),
  intermediate: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-haiku-3-5-20241022',
    max_tokens: 4000,
    temperature: 0.3,
  }),
  junior: ModelConfigSchema.default({
    provider: 'openai',
    model: 'gpt-4o-mini',
    max_tokens: 4000,
    temperature: 0.2,
  }),
  qa: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    temperature: 0.2,
  }),
});

// Scaling rules
const ScalingConfigSchema = z.object({
  // Story points threshold before hiring additional senior
  senior_capacity: z.number().int().positive().default(20),
  // Complexity threshold for delegation to junior
  junior_max_complexity: z.number().int().min(1).max(13).default(3),
  // Complexity threshold for delegation to intermediate
  intermediate_max_complexity: z.number().int().min(1).max(13).default(5),
});

// GitHub integration
const GitHubConfigSchema = z.object({
  // Base branch for PRs
  base_branch: z.string().default('main'),
  // PR template
  pr_template: z.string().default(`## Story: {story_id}

{description}

### Acceptance Criteria
{acceptance_criteria}

### Changes
{changes}`),
});

// QA configuration
const QAConfigSchema = z.object({
  // Commands to run for quality checks
  quality_checks: z.array(z.string()).default(['npm run lint', 'npm run type-check']),
  // Build command
  build_command: z.string().default('npm run build'),
  // Test command (optional)
  test_command: z.string().optional(),
});

// Agent behavior configuration
const AgentsConfigSchema = z.object({
  // Polling interval for state checks (ms)
  poll_interval: z.number().int().positive().default(5000),
  // Max retries before escalation
  max_retries: z.number().int().nonnegative().default(2),
  // Token threshold for checkpoint
  checkpoint_threshold: z.number().int().positive().default(14000),
  // LLM call timeout in milliseconds (default: 30 minutes)
  llm_timeout_ms: z.number().int().positive().default(1800000),
  // Max retries for LLM calls on timeout
  llm_max_retries: z.number().int().nonnegative().default(2),
});

// Manager daemon configuration
const ManagerConfigSchema = z.object({
  fast_poll_interval: z.number().int().positive().default(15000),
  slow_poll_interval: z.number().int().positive().default(60000),
});

// Logging configuration
const LoggingConfigSchema = z.object({
  // Log level
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Retain logs for N days
  retention_days: z.number().int().positive().default(30),
});

// Main configuration schema
export const HiveConfigSchema = z.object({
  version: z.string().default('1.0'),
  models: ModelsConfigSchema.default({}),
  scaling: ScalingConfigSchema.default({}),
  github: GitHubConfigSchema.default({}),
  qa: QAConfigSchema.default({}),
  agents: AgentsConfigSchema.default({}),
  manager: ManagerConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

// Export types
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type ScalingConfig = z.infer<typeof ScalingConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type QAConfig = z.infer<typeof QAConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type ManagerConfig = z.infer<typeof ManagerConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type HiveConfig = z.infer<typeof HiveConfigSchema>;

// Default configuration
export const DEFAULT_CONFIG: HiveConfig = HiveConfigSchema.parse({});

// Generate default config YAML content
export function generateDefaultConfigYaml(): string {
  return `# Hive Orchestrator Configuration
version: "1.0"

# Model assignments per agent tier
models:
  tech_lead:
    provider: anthropic
    model: claude-opus-4-20250514
    max_tokens: 16000
    temperature: 0.7

  senior:
    provider: anthropic
    model: claude-sonnet-4-20250514
    max_tokens: 8000
    temperature: 0.5

  intermediate:
    provider: anthropic
    model: claude-haiku-3-5-20241022
    max_tokens: 4000
    temperature: 0.3

  junior:
    provider: openai
    model: gpt-4o-mini
    max_tokens: 4000
    temperature: 0.2

  qa:
    provider: anthropic
    model: claude-sonnet-4-20250514
    max_tokens: 8000
    temperature: 0.2

# Team scaling rules
scaling:
  # Story points threshold before hiring additional senior
  senior_capacity: 20
  # Complexity threshold for delegation
  junior_max_complexity: 3
  intermediate_max_complexity: 5

# GitHub integration
github:
  # Base branch for PRs
  base_branch: main
  # PR template
  pr_template: |
    ## Story: {story_id}

    {description}

    ### Acceptance Criteria
    {acceptance_criteria}

    ### Changes
    {changes}

# QA configuration
qa:
  # Commands to run for quality checks
  quality_checks:
    - npm run lint
    - npm run type-check
  # Build command
  build_command: npm run build
  # Test command (optional)
  # test_command: npm test

# Agent behavior
agents:
  # Polling interval for state checks (ms)
  poll_interval: 5000
  # Max retries before escalation
  max_retries: 2
  # Token threshold for checkpoint
  checkpoint_threshold: 14000
  # LLM call timeout in milliseconds (default: 30 minutes)
  llm_timeout_ms: 1800000
  # Max retries for LLM calls on timeout
  llm_max_retries: 2

# Logging
logging:
  level: info
  # Retain logs for N days
  retention_days: 30
`;
}
