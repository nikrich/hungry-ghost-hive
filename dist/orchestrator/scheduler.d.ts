import type { Database } from 'sql.js';
import { type StoryRow } from '../db/queries/stories.js';
import type { ScalingConfig } from '../config/schema.js';
export interface SchedulerConfig {
    scaling: ScalingConfig;
    rootDir: string;
}
export declare class Scheduler {
    private db;
    private config;
    constructor(db: Database, config: SchedulerConfig);
    /**
     * Build a dependency graph for stories
     * Returns a map of story ID to its direct dependencies
     */
    private buildDependencyGraph;
    /**
     * Topological sort of stories based on dependencies
     * Returns stories in order where dependencies come before dependents
     * Returns null if circular dependency is detected
     */
    private topologicalSort;
    /**
     * Check if a story's dependencies are satisfied
     * A dependency is satisfied if it's completed (merged) or in progress (being worked on)
     */
    private areDependenciesSatisfied;
    /**
     * Select the agent with the least workload (queue-depth aware)
     * Returns the agent with fewest active stories; breaks ties by creation order
     */
    private selectAgentWithLeastWorkload;
    /**
     * Calculate queue depth for an agent (number of active stories)
     */
    private getAgentWorkload;
    /**
     * Assign planned stories to available agents
     */
    assignStories(): Promise<{
        assigned: number;
        errors: string[];
    }>;
    /**
     * Get the next story to work on for a specific agent
     */
    getNextStoryForAgent(agentId: string): StoryRow | null;
    /**
     * Check if scaling is needed based on workload
     */
    checkScaling(): Promise<void>;
    /**
     * Health check: sync agent status with actual tmux sessions
     * Returns number of agents whose status was corrected
     */
    healthCheck(): Promise<{
        terminated: number;
        revived: string[];
    }>;
    /**
     * Check merge queue and spawn QA agents if needed
     */
    checkMergeQueue(): Promise<void>;
    private spawnQA;
    private ensureManagerRunning;
    private spawnSenior;
    private spawnIntermediate;
    private spawnJunior;
    private getTeamStories;
}
//# sourceMappingURL=scheduler.d.ts.map