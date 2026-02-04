import type Database from 'better-sqlite3';
import type { ScalingConfig } from '../config/schema.js';
export interface ScalerConfig {
    scaling: ScalingConfig;
}
export interface ScalingRecommendation {
    teamId: string;
    teamName: string;
    currentSeniors: number;
    recommendedSeniors: number;
    action: 'scale_up' | 'scale_down' | 'none';
    reason: string;
}
export declare class Scaler {
    private db;
    private config;
    constructor(db: Database.Database, config: ScalerConfig);
    /**
     * Analyze current workload and recommend scaling actions
     */
    analyzeScaling(): ScalingRecommendation[];
    private analyzeTeam;
    /**
     * Scale down idle agents when workload decreases
     */
    scaleDown(): Promise<number>;
    private terminateAgent;
    /**
     * Get scaling statistics
     */
    getStatistics(): {
        totalAgents: number;
        activeAgents: number;
        agentsByType: Record<string, number>;
        teamCapacity: Record<string, {
            agents: number;
            storyPoints: number;
        }>;
    };
}
//# sourceMappingURL=scaler.d.ts.map