import { z } from 'zod';
declare const ModelConfigSchema: z.ZodObject<{
    provider: z.ZodEnum<["anthropic", "openai"]>;
    model: z.ZodString;
    max_tokens: z.ZodDefault<z.ZodNumber>;
    temperature: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    model: string;
    provider: "anthropic" | "openai";
    max_tokens: number;
    temperature: number;
}, {
    model: string;
    provider: "anthropic" | "openai";
    max_tokens?: number | undefined;
    temperature?: number | undefined;
}>;
declare const ModelsConfigSchema: z.ZodObject<{
    tech_lead: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    }>>;
    senior: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    }>>;
    intermediate: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    }>>;
    junior: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    }>>;
    qa: z.ZodDefault<z.ZodObject<{
        provider: z.ZodEnum<["anthropic", "openai"]>;
        model: z.ZodString;
        max_tokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    }, {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    tech_lead: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    };
    senior: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    };
    intermediate: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    };
    junior: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    };
    qa: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens: number;
        temperature: number;
    };
}, {
    tech_lead?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    } | undefined;
    senior?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    } | undefined;
    intermediate?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    } | undefined;
    junior?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    } | undefined;
    qa?: {
        model: string;
        provider: "anthropic" | "openai";
        max_tokens?: number | undefined;
        temperature?: number | undefined;
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
}, "strip", z.ZodTypeAny, {
    quality_checks: string[];
    build_command: string;
    test_command?: string | undefined;
}, {
    quality_checks?: string[] | undefined;
    build_command?: string | undefined;
    test_command?: string | undefined;
}>;
declare const AgentsConfigSchema: z.ZodObject<{
    poll_interval: z.ZodDefault<z.ZodNumber>;
    max_retries: z.ZodDefault<z.ZodNumber>;
    checkpoint_threshold: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    poll_interval: number;
    max_retries: number;
    checkpoint_threshold: number;
}, {
    poll_interval?: number | undefined;
    max_retries?: number | undefined;
    checkpoint_threshold?: number | undefined;
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
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        }>>;
        senior: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        }>>;
        intermediate: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        }>>;
        junior: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        }>>;
        qa: z.ZodDefault<z.ZodObject<{
            provider: z.ZodEnum<["anthropic", "openai"]>;
            model: z.ZodString;
            max_tokens: z.ZodDefault<z.ZodNumber>;
            temperature: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        }, {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        tech_lead: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        senior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        intermediate: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        junior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        qa: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
    }, {
        tech_lead?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        senior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        intermediate?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        junior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        qa?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
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
    }, "strip", z.ZodTypeAny, {
        quality_checks: string[];
        build_command: string;
        test_command?: string | undefined;
    }, {
        quality_checks?: string[] | undefined;
        build_command?: string | undefined;
        test_command?: string | undefined;
    }>>;
    agents: z.ZodDefault<z.ZodObject<{
        poll_interval: z.ZodDefault<z.ZodNumber>;
        max_retries: z.ZodDefault<z.ZodNumber>;
        checkpoint_threshold: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        poll_interval: number;
        max_retries: number;
        checkpoint_threshold: number;
    }, {
        poll_interval?: number | undefined;
        max_retries?: number | undefined;
        checkpoint_threshold?: number | undefined;
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
    };
    qa: {
        quality_checks: string[];
        build_command: string;
        test_command?: string | undefined;
    };
    version: string;
    models: {
        tech_lead: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        senior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        intermediate: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        junior: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
        qa: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens: number;
            temperature: number;
        };
    };
    scaling: {
        senior_capacity: number;
        junior_max_complexity: number;
        intermediate_max_complexity: number;
    };
    github: {
        base_branch: string;
        pr_template: string;
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
    } | undefined;
    qa?: {
        quality_checks?: string[] | undefined;
        build_command?: string | undefined;
        test_command?: string | undefined;
    } | undefined;
    version?: string | undefined;
    models?: {
        tech_lead?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        senior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        intermediate?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        junior?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
        qa?: {
            model: string;
            provider: "anthropic" | "openai";
            max_tokens?: number | undefined;
            temperature?: number | undefined;
        } | undefined;
    } | undefined;
    scaling?: {
        senior_capacity?: number | undefined;
        junior_max_complexity?: number | undefined;
        intermediate_max_complexity?: number | undefined;
    } | undefined;
    github?: {
        base_branch?: string | undefined;
        pr_template?: string | undefined;
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
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type HiveConfig = z.infer<typeof HiveConfigSchema>;
export declare const DEFAULT_CONFIG: HiveConfig;
export declare function generateDefaultConfigYaml(): string;
export {};
//# sourceMappingURL=schema.d.ts.map