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
    private spawnSenior;
    private spawnIntermediate;
    private spawnJunior;
}
//# sourceMappingURL=scheduler.d.ts.map