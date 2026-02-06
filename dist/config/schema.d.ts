import { z } from 'zod';
declare const ModelConfigSchema: z.ZodObject<{
    provider: z.ZodEnum<["anthropic", "openai"]>;
    model: z.ZodString;
    max_tokens: z.ZodDefault<z.ZodNumber>;
    temperature: z.ZodDefault<z.ZodNumber>;
    cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
}, "strip", z.ZodTypeAny, {
    model: string;
    provider: "anthropic" | "openai";
    max_tokens: number;
    temperature: number;
    cli_tool: "claude" | "codex" | "gemini";
}, {
    model: string;
    provider: "anthropic" | "openai";
    max_tokens?: number | undefined;
    temperature?: number | undefined;
    cli_tool?: "claude" | "codex" | "gemini" | undefined;
}>;
declare const ModelsConfigSchema: z.ZodObject<{
    tech_lead: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    }>>;
    senior: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    }>>;
    intermediate: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    }>>;
    junior: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    }>>;
    qa: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    tech_lead: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    };
    senior: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    };
    intermediate: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    };
    junior: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    };
    qa: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
        cli_tool: "claude" | "codex" | "gemini";
    };
}, {
    tech_lead?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    } | undefined;
    senior?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    } | undefined;
    intermediate?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    } | undefined;
    junior?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    } | undefined;
    qa?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
        cli_tool?: "claude" | "codex" | "gemini" | undefined;
    } | undefined;
}>;
declare const ScalingConfigSchema: z.ZodObject<{
    senior_capacity: z.ZodDefault<z.ZodNumber>;
    junior_max_complexity: z.ZodDefault<z.ZodNumber>;
    intermediate_max_complexity: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    senior_capacity: number;
    junior_max_complexity: number;
    intermediate_max_complexity: number;
}, {
    senior_capacity?: number | undefined;
    junior_max_complexity?: number | undefined;
    intermediate_max_complexity?: number | undefined;
}>;
declare const GitHubConfigSchema: z.ZodObject<{
    base_branch: z.ZodDefault<z.ZodString>;
    pr_template: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    base_branch: string;
    pr_template: string;
}, {
    base_branch?: string | undefined;
    pr_template?: string | undefined;
}>;
declare const QAConfigSchema: z.ZodObject<{
    quality_checks: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    build_command: z.ZodDefault<z.ZodString>;
    test_command: z.ZodOptional<z.ZodString>;
    scaling: z.ZodOptional<z.ZodObject<{
        pending_per_agent: z.ZodDefault<z.ZodNumber>;
        max_agents: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        pending_per_agent: number;
        max_agents: number;
    }, {
        pending_per_agent?: number | undefined;
        max_agents?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    quality_checks: string[];
    build_command: string;
    test_command?: string | undefined;
    scaling?: {
        pending_per_agent: number;
        max_agents: number;
    } | undefined;
}, {
    quality_checks?: string[] | undefined;
    build_command?: string | undefined;
    test_command?: string | undefined;
    scaling?: {
        pending_per_agent?: number | undefined;
        max_agents?: number | undefined;
    } | undefined;
}>;
declare const AgentsConfigSchema: z.ZodObject<{
    poll_interval: z.ZodDefault<z.ZodNumber>;
    max_retries: z.ZodDefault<z.ZodNumber>;
    checkpoint_threshold: z.ZodDefault<z.ZodNumber>;
    llm_timeout_ms: z.ZodDefault<z.ZodNumber>;
    llm_max_retries: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    poll_interval: number;
    max_retries: number;
    checkpoint_threshold: number;
    llm_timeout_ms: number;
    llm_max_retries: number;
}, {
    poll_interval?: number | undefined;
    max_retries?: number | undefined;
    checkpoint_threshold?: number | undefined;
    llm_timeout_ms?: number | undefined;
    llm_max_retries?: number | undefined;
}>;
declare const ManagerConfigSchema: z.ZodObject<{
    fast_poll_interval: z.ZodDefault<z.ZodNumber>;
    slow_poll_interval: z.ZodDefault<z.ZodNumber>;
    stuck_threshold_ms: z.ZodDefault<z.ZodNumber>;
    nudge_cooldown_ms: z.ZodDefault<z.ZodNumber>;
    lock_stale_ms: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    fast_poll_interval: number;
    slow_poll_interval: number;
    stuck_threshold_ms: number;
    nudge_cooldown_ms: number;
    lock_stale_ms: number;
}, {
    fast_poll_interval?: number | undefined;
    slow_poll_interval?: number | undefined;
    stuck_threshold_ms?: number | undefined;
    nudge_cooldown_ms?: number | undefined;
    lock_stale_ms?: number | undefined;
}>;
declare const LoggingConfigSchema: z.ZodObject<{
    level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    retention_days: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    level: "debug" | "info" | "warn" | "error";
    retention_days: number;
}, {
    level?: "debug" | "info" | "warn" | "error" | undefined;
    retention_days?: number | undefined;
}>;
export declare const HiveConfigSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodString>;
    models: z.ZodDefault<z.ZodObject<{
        tech_lead: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
            cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        }>>;
        senior: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
            cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        }>>;
        intermediate: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
            cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        }>>;
        junior: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
            cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        }>>;
        qa: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
            cli_tool: z.ZodDefault<z.ZodOptional<z.ZodEnum<["claude", "codex", "gemini"]>>>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        tech_lead: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        senior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        intermediate: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        junior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        qa: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
    }, {
        tech_lead?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        senior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        intermediate?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        junior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        qa?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
    }>>;
    scaling: z.ZodDefault<z.ZodObject<{
        senior_capacity: z.ZodDefault<z.ZodNumber>;
        junior_max_complexity: z.ZodDefault<z.ZodNumber>;
        intermediate_max_complexity: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        senior_capacity: number;
        junior_max_complexity: number;
        intermediate_max_complexity: number;
    }, {
        senior_capacity?: number | undefined;
        junior_max_complexity?: number | undefined;
        intermediate_max_complexity?: number | undefined;
    }>>;
    github: z.ZodDefault<z.ZodObject<{
        base_branch: z.ZodDefault<z.ZodString>;
        pr_template: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        base_branch: string;
        pr_template: string;
    }, {
        base_branch?: string | undefined;
        pr_template?: string | undefined;
    }>>;
    qa: z.ZodDefault<z.ZodObject<{
        quality_checks: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        build_command: z.ZodDefault<z.ZodString>;
        test_command: z.ZodOptional<z.ZodString>;
        scaling: z.ZodOptional<z.ZodObject<{
            pending_per_agent: z.ZodDefault<z.ZodNumber>;
            max_agents: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            pending_per_agent: number;
            max_agents: number;
        }, {
            pending_per_agent?: number | undefined;
            max_agents?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        quality_checks: string[];
        build_command: string;
        test_command?: string | undefined;
        scaling?: {
            pending_per_agent: number;
            max_agents: number;
        } | undefined;
    }, {
        quality_checks?: string[] | undefined;
        build_command?: string | undefined;
        test_command?: string | undefined;
        scaling?: {
            pending_per_agent?: number | undefined;
            max_agents?: number | undefined;
        } | undefined;
    }>>;
    agents: z.ZodDefault<z.ZodObject<{
        poll_interval: z.ZodDefault<z.ZodNumber>;
        max_retries: z.ZodDefault<z.ZodNumber>;
        checkpoint_threshold: z.ZodDefault<z.ZodNumber>;
        llm_timeout_ms: z.ZodDefault<z.ZodNumber>;
        llm_max_retries: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        poll_interval: number;
        max_retries: number;
        checkpoint_threshold: number;
        llm_timeout_ms: number;
        llm_max_retries: number;
    }, {
        poll_interval?: number | undefined;
        max_retries?: number | undefined;
        checkpoint_threshold?: number | undefined;
        llm_timeout_ms?: number | undefined;
        llm_max_retries?: number | undefined;
    }>>;
    manager: z.ZodDefault<z.ZodObject<{
        fast_poll_interval: z.ZodDefault<z.ZodNumber>;
        slow_poll_interval: z.ZodDefault<z.ZodNumber>;
        stuck_threshold_ms: z.ZodDefault<z.ZodNumber>;
        nudge_cooldown_ms: z.ZodDefault<z.ZodNumber>;
        lock_stale_ms: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        fast_poll_interval: number;
        slow_poll_interval: number;
        stuck_threshold_ms: number;
        nudge_cooldown_ms: number;
        lock_stale_ms: number;
    }, {
        fast_poll_interval?: number | undefined;
        slow_poll_interval?: number | undefined;
        stuck_threshold_ms?: number | undefined;
        nudge_cooldown_ms?: number | undefined;
        lock_stale_ms?: number | undefined;
    }>>;
    logging: z.ZodDefault<z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
        retention_days: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        level: "debug" | "info" | "warn" | "error";
        retention_days: number;
    }, {
        level?: "debug" | "info" | "warn" | "error" | undefined;
        retention_days?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    agents: {
        poll_interval: number;
        max_retries: number;
        checkpoint_threshold: number;
        llm_timeout_ms: number;
        llm_max_retries: number;
    };
    qa: {
        quality_checks: string[];
        build_command: string;
        test_command?: string | undefined;
        scaling?: {
            pending_per_agent: number;
            max_agents: number;
        } | undefined;
    };
    scaling: {
        senior_capacity: number;
        junior_max_complexity: number;
        intermediate_max_complexity: number;
    };
    version: string;
    models: {
        tech_lead: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        senior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        intermediate: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        junior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
        qa: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
            cli_tool: "claude" | "codex" | "gemini";
        };
    };
    github: {
        base_branch: string;
        pr_template: string;
    };
    manager: {
        fast_poll_interval: number;
        slow_poll_interval: number;
        stuck_threshold_ms: number;
        nudge_cooldown_ms: number;
        lock_stale_ms: number;
    };
    logging: {
        level: "debug" | "info" | "warn" | "error";
        retention_days: number;
    };
}, {
    agents?: {
        poll_interval?: number | undefined;
        max_retries?: number | undefined;
        checkpoint_threshold?: number | undefined;
        llm_timeout_ms?: number | undefined;
        llm_max_retries?: number | undefined;
    } | undefined;
    qa?: {
        quality_checks?: string[] | undefined;
        build_command?: string | undefined;
        test_command?: string | undefined;
        scaling?: {
            pending_per_agent?: number | undefined;
            max_agents?: number | undefined;
        } | undefined;
    } | undefined;
    scaling?: {
        senior_capacity?: number | undefined;
        junior_max_complexity?: number | undefined;
        intermediate_max_complexity?: number | undefined;
    } | undefined;
    version?: string | undefined;
    models?: {
        tech_lead?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        senior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        intermediate?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        junior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
        qa?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
            cli_tool?: "claude" | "codex" | "gemini" | undefined;
        } | undefined;
    } | undefined;
    github?: {
        base_branch?: string | undefined;
        pr_template?: string | undefined;
    } | undefined;
    manager?: {
        fast_poll_interval?: number | undefined;
        slow_poll_interval?: number | undefined;
        stuck_threshold_ms?: number | undefined;
        nudge_cooldown_ms?: number | undefined;
        lock_stale_ms?: number | undefined;
    } | undefined;
    logging?: {
        level?: "debug" | "info" | "warn" | "error" | undefined;
        retention_days?: number | undefined;
    } | undefined;
}>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type ScalingConfig = z.infer<typeof ScalingConfigSchema>;
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type QAConfig = z.infer<typeof QAConfigSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type ManagerConfig = z.infer<typeof ManagerConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type HiveConfig = z.infer<typeof HiveConfigSchema>;
export declare const DEFAULT_CONFIG: HiveConfig;
export declare function generateDefaultConfigYaml(): string;
export {};
//# sourceMappingURL=schema.d.ts.map