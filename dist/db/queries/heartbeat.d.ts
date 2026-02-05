import type { Database } from 'sql.js';
/**
 * Update agent's last_seen timestamp (heartbeat)
 */
export declare function updateAgentHeartbeat(db: Database, agentId: string): void;
/**
 * Get agents that haven't sent a heartbeat within the specified timeout (in seconds)
 */
export declare function getStaleAgents(db: Database, timeoutSeconds?: number): Array<{
    id: string;
    type: string;
    status: string;
    last_seen: string | null;
    seconds_since_heartbeat: number;
}>;
/**
 * Check if agent's heartbeat is current (within timeout)
 */
export declare function isAgentHeartbeatCurrent(db: Database, agentId: string, timeoutSeconds?: number): boolean;
//# sourceMappingURL=heartbeat.d.ts.map