// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { z } from 'zod';

// Model configuration for each agent type
const ModelConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: z.string(),
  max_tokens: z.number().int().positive().default(8000),
  temperature: z.number().min(0).max(2).default(0.5),
  cli_tool: z.enum(['claude', 'codex', 'gemini']).optional().default('claude'),
  safety_mode: z.enum(['safe', 'unsafe']).optional().default('unsafe'),
});

// Models configuration for all agent types
const ModelsConfigSchema = z.object({
  tech_lead: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    temperature: 0.7,
    cli_tool: 'claude',
    safety_mode: 'unsafe',
  }),
  senior: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    temperature: 0.5,
    cli_tool: 'claude',
    safety_mode: 'unsafe',
  }),
  intermediate: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4000,
    temperature: 0.3,
    cli_tool: 'claude',
    safety_mode: 'unsafe',
  }),
  junior: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    temperature: 0.3,
    cli_tool: 'claude',
    safety_mode: 'unsafe',
  }),
  qa: ModelConfigSchema.default({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    temperature: 0.2,
    cli_tool: 'claude',
    safety_mode: 'unsafe',
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
  // Policy for organic refactoring work discovered by engineers
  refactor: z
    .object({
      // Master toggle for scheduling refactor stories
      enabled: z.boolean().default(true),
      // Refactor capacity budget as a percentage of feature workload
      capacity_percent: z.number().min(0).max(100).default(10),
      // If true, allow refactor-only queues to proceed when no feature work is planned
      allow_without_feature_work: z.boolean().default(true),
    })
    .default({}),
});

// Source control integration
const SourceControlConfigSchema = z.object({
  // Source control provider
  provider: z.string().min(1).default('github'),
});

// Jira configuration for project management
const JiraConfigSchema = z.object({
  // Jira project key (e.g., "HIVE")
  project_key: z.string().min(1),
  // Jira site URL (e.g., "https://mycompany.atlassian.net")
  site_url: z.string().url(),
  // Jira board ID for the team (optional — only needed for sprint operations)
  board_id: z.string().min(1).optional(),
  // Story type in Jira (e.g., "Story")
  story_type: z.string().min(1).default('Story'),
  // Subtask type in Jira (e.g., "Subtask")
  subtask_type: z.string().min(1).default('Subtask'),
  // Jira field ID for story points (e.g., "story_points" for next-gen, "customfield_10016" for classic)
  story_points_field: z.string().min(1).default('story_points'),
  // Status mapping from Jira status to internal status
  status_mapping: z.record(z.string()).default({}),
  // Whether to watch the board for changes (polling) — deprecated, ignored
  watch_board: z.boolean().default(false).optional(),
  // Board polling interval in milliseconds — deprecated, ignored
  board_poll_interval_ms: z.number().int().positive().default(60000).optional(),
});

// Project management integration
const ProjectManagementConfigSchema = z.object({
  // Project management provider (none = no PM integration)
  provider: z.string().min(1).default('none'),
  // Jira-specific configuration (required when provider is 'jira')
  jira: JiraConfigSchema.optional(),
});

// Autonomy configuration
const AutonomyConfigSchema = z.object({
  // Agent autonomy level
  level: z.enum(['full', 'partial']).default('full'),
});

// Integrations configuration
const IntegrationsConfigSchema = z
  .object({
    source_control: SourceControlConfigSchema.default({}),
    project_management: ProjectManagementConfigSchema.default({}),
    autonomy: AutonomyConfigSchema.default({}),
  })
  .superRefine((integrations, ctx) => {
    // Validate that jira config is provided when provider is 'jira'
    if (
      integrations.project_management.provider === 'jira' &&
      !integrations.project_management.jira
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project_management', 'jira'],
        message: 'jira configuration is required when provider is "jira"',
      });
    }
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
  // QA agent scaling configuration
  scaling: z
    .object({
      // Pending PRs per QA agent (e.g., 2.5 means 1 QA per 2.5 pending)
      pending_per_agent: z.number().positive().default(2.5),
      // Maximum number of QA agents per team
      max_agents: z.number().int().positive().default(5),
    })
    .optional(),
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
const ManagerCompletionClassifierConfigSchema = z.object({
  cli_tool: z.enum(['claude', 'codex', 'gemini']).default('codex'),
  model: z.string().default('gpt-5.2-codex'),
  timeout_ms: z.number().int().positive().default(300000),
  // Backward-compatible deprecated fields (ignored by manager classifier path).
  provider: z.enum(['anthropic', 'openai']).optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const ManagerConfigSchema = z.object({
  fast_poll_interval: z.number().int().positive().default(15000),
  slow_poll_interval: z.number().int().positive().default(60000),
  stuck_threshold_ms: z.number().int().positive().default(120000),
  nudge_cooldown_ms: z.number().int().positive().default(300000),
  // Maximum number of stuck nudges to send per stalled story/session window.
  max_stuck_nudges_per_story: z.number().int().nonnegative().default(1),
  // Static-screen inactivity window before full AI stuck/done assessment
  screen_static_inactivity_threshold_ms: z.number().int().positive().default(600000),
  // AI model used by manager semantic done/stuck classifier
  completion_classifier: ManagerCompletionClassifierConfigSchema.default({}),
  lock_stale_ms: z.number().int().positive().default(120000),
  // Shell command timeouts to prevent manager hangs
  git_timeout_ms: z.number().int().positive().default(30000), // 30s for git operations
  gh_timeout_ms: z.number().int().positive().default(60000), // 60s for GitHub API calls
  tmux_timeout_ms: z.number().int().positive().default(10000), // 10s for tmux commands
});

// Merge queue configuration
const MergeQueueConfigSchema = z.object({
  // Maximum age in hours for PRs to be synced into the queue
  // PRs older than this are considered stale and skipped during sync
  max_age_hours: z.number().positive().default(168), // 7 days default
});

// Logging configuration
const LoggingConfigSchema = z.object({
  // Log level
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Retain logs for N days
  retention_days: z.number().int().positive().default(30),
});

// Cluster peer configuration
const ClusterPeerSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
});

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

// Distributed cluster configuration (feature-flagged)
const ClusterConfigSchema = z
  .object({
    // Enable distributed mode
    enabled: z.boolean().default(false),
    // Stable unique ID for this host/node
    node_id: z.string().min(1).default('node-local'),
    // HTTP bind host for cluster API
    listen_host: z.string().min(1).default('127.0.0.1'),
    // HTTP bind port for cluster API
    listen_port: z.number().int().min(1).max(65535).default(8787),
    // Public URL peers can use to reach this node
    public_url: z.string().url().default('http://127.0.0.1:8787'),
    // Other nodes in this cluster
    peers: z.array(ClusterPeerSchema).default([]),
    // Bearer token for cluster API (required when exposed beyond loopback)
    auth_token: z.string().min(1).optional(),
    // Leader election heartbeat interval
    heartbeat_interval_ms: z.number().int().positive().default(2000),
    // Randomized election timeout lower bound
    election_timeout_min_ms: z.number().int().positive().default(3000),
    // Randomized election timeout upper bound
    election_timeout_max_ms: z.number().int().positive().default(6000),
    // Anti-entropy sync cadence
    sync_interval_ms: z.number().int().positive().default(5000),
    // Outbound HTTP request timeout for peer calls
    request_timeout_ms: z.number().int().positive().default(5000),
    // Story similarity threshold [0..1] for duplicate merge detection
    story_similarity_threshold: z.number().min(0).max(1).default(0.92),
  })
  .superRefine((cluster, ctx) => {
    if (!cluster.enabled) return;

    if (!isLoopbackHost(cluster.listen_host) && !cluster.auth_token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auth_token'],
        message: 'auth_token is required when cluster.listen_host is not loopback',
      });
    }
  });

// Main configuration schema
export const HiveConfigSchema = z.object({
  version: z.string().default('1.0'),
  models: ModelsConfigSchema.default({}),
  scaling: ScalingConfigSchema.default({}),
  integrations: IntegrationsConfigSchema.default({}),
  github: GitHubConfigSchema.default({}),
  qa: QAConfigSchema.default({}),
  agents: AgentsConfigSchema.default({}),
  manager: ManagerConfigSchema.default({}),
  merge_queue: MergeQueueConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  cluster: ClusterConfigSchema.default({}),
});

// Export types
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type ScalingConfig = z.infer<typeof ScalingConfigSchema>;
export type SourceControlConfig = z.infer<typeof SourceControlConfigSchema>;
export type JiraConfig = z.infer<typeof JiraConfigSchema>;
export type ProjectManagementConfig = z.infer<typeof ProjectManagementConfigSchema>;
export type AutonomyConfig = z.infer<typeof AutonomyConfigSchema>;
export type IntegrationsConfig = z.infer<typeof IntegrationsConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type QAConfig = z.infer<typeof QAConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type ManagerConfig = z.infer<typeof ManagerConfigSchema>;
export type MergeQueueConfig = z.infer<typeof MergeQueueConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type ClusterPeerConfig = z.infer<typeof ClusterPeerSchema>;
export type ClusterConfig = z.infer<typeof ClusterConfigSchema>;
export type HiveConfig = z.infer<typeof HiveConfigSchema>;

// Default configuration
export const DEFAULT_CONFIG: HiveConfig = HiveConfigSchema.parse({});

// Generate default config YAML content
export function generateDefaultConfigYaml(): string {
  return `# Hive Orchestrator Configuration
version: "1.0"

# Integrations configuration
integrations:
  # Source control provider (github, bitbucket, gitlab)
  source_control:
    provider: github
  # Project management provider (none, jira)
  project_management:
    provider: none
    # Jira configuration (required when provider is 'jira')
    # jira:
    #   project_key: HIVE
    #   site_url: https://mycompany.atlassian.net
    #   story_type: Story
    #   subtask_type: Subtask
    #   status_mapping:
    #     "To Do": draft
    #     "In Progress": in_progress
    #     "In Review": review
    #     "Done": merged
  # Agent autonomy level (full, partial)
  autonomy:
    level: full

# Model assignments per agent tier
models:
  tech_lead:
    provider: anthropic
    model: claude-opus-4-6
    max_tokens: 16000
    temperature: 0.7
    # CLI tool used to spawn agents (claude, codex, or gemini)
    cli_tool: claude
    # Runtime safety policy (safe = approval prompts, unsafe = full automation)
    safety_mode: unsafe

  senior:
    provider: anthropic
    model: claude-opus-4-6
    max_tokens: 8000
    temperature: 0.5
    cli_tool: claude
    safety_mode: unsafe

  intermediate:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    max_tokens: 4000
    temperature: 0.3
    cli_tool: claude
    safety_mode: unsafe

  junior:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    max_tokens: 4000
    temperature: 0.2
    cli_tool: claude
    safety_mode: unsafe

  qa:
    provider: anthropic
    model: claude-sonnet-4-5-20250929
    max_tokens: 8000
    temperature: 0.2
    cli_tool: claude
    safety_mode: unsafe

# Team scaling rules
scaling:
  # Story points threshold before hiring additional senior
  senior_capacity: 20
  # Complexity threshold for delegation
  junior_max_complexity: 3
  intermediate_max_complexity: 5
  # Organic refactor scheduling policy
  refactor:
    # Master toggle for assigning refactor stories
    enabled: true
    # Refactor budget as a percentage of feature workload
    capacity_percent: 10
    # Allow refactor work even when only refactor stories exist
    allow_without_feature_work: true

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

# Manager daemon (micromanager nudge behavior)
manager:
  # Quick poll interval for fast checks (ms)
  fast_poll_interval: 15000
  # Standard poll interval for regular checks (ms)
  slow_poll_interval: 60000
  # Time to consider agent stuck if state hasn't changed (ms)
  stuck_threshold_ms: 120000
  # Cooldown period before nudging the same agent again (ms)
  nudge_cooldown_ms: 300000
  # Max stuck nudges per stalled story/session window (0 disables stuck nudges)
  max_stuck_nudges_per_story: 1
  # Static inactivity window before full AI analysis (ms, default 10 minutes)
  screen_static_inactivity_threshold_ms: 600000
  # AI semantic classifier model used by manager for done/stuck inference
  completion_classifier:
    cli_tool: codex
    model: gpt-5.2-codex
    timeout_ms: 300000
  # Time before manager lock is considered stale (ms)
  lock_stale_ms: 120000
  # Timeout for git operations to prevent manager hangs (ms)
  git_timeout_ms: 30000
  # Timeout for GitHub CLI operations to prevent manager hangs (ms)
  gh_timeout_ms: 60000
  # Timeout for tmux operations to prevent manager hangs (ms)
  tmux_timeout_ms: 10000

# Merge queue configuration
merge_queue:
  # Maximum age in hours for PRs to be synced (default: 168 = 7 days)
  # PRs older than this are considered stale and skipped
  max_age_hours: 168

# Logging
logging:
  level: info
  # Retain logs for N days
  retention_days: 30

# Distributed cluster mode (disabled by default)
cluster:
  # Feature flag
  enabled: false
  # Unique stable ID for this host
  node_id: node-local
  # HTTP listen address for cluster coordination/sync
  listen_host: 127.0.0.1
  listen_port: 8787
  # Publicly reachable URL for peers
  public_url: http://127.0.0.1:8787
  # Required when listen_host is not loopback
  # auth_token: your-shared-token
  # Cluster members (other hosts in the same cluster)
  peers: []
  # Leader election cadence
  heartbeat_interval_ms: 2000
  election_timeout_min_ms: 3000
  election_timeout_max_ms: 6000
  # State replication cadence
  sync_interval_ms: 5000
  request_timeout_ms: 5000
  # Duplicate story detection sensitivity
  story_similarity_threshold: 0.92
`;
}
