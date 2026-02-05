import type { Database } from 'sql.js';
import { run } from '../client.js';

/**
 * Update agent's last_seen timestamp (heartbeat)
 */
export function updateAgentHeartbeat(db: Database, agentId: string): void {
  run(db,
    "UPDATE agents SET last_seen = CURRENT_TIMESTAMP WHERE id = ?",
    [agentId]
  );
}

/**
 * Get agents that haven't sent a heartbeat within the specified timeout (in seconds)
 */
export function getStaleAgents(db: Database, timeoutSeconds: number = 15): Array<{
  id: string;
  type: string;
  status: string;
  last_seen: string | null;
  seconds_since_heartbeat: number;
}> {
  const query = `
    SELECT
      id,
      type,
      status,
      last_seen,
      CAST((julianday('now') - julianday(COALESCE(last_seen, created_at))) * 86400 AS INTEGER) as seconds_since_heartbeat
    FROM agents
    WHERE status IN ('working', 'idle')
      AND (
        (last_seen IS NULL AND (julianday('now') - julianday(created_at)) * 86400 > (60 + ?))
        OR
        (last_seen IS NOT NULL AND (julianday('now') - julianday(last_seen)) * 86400 > ?)
      )
  `;

  const stmt = db.prepare(query);
  stmt.bind([timeoutSeconds, timeoutSeconds]);

  const results: Array<{
    id: string;
    type: string;
    status: string;
    last_seen: string | null;
    seconds_since_heartbeat: number;
  }> = [];

  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: string;
      type: string;
      status: string;
      last_seen: string | null;
      seconds_since_heartbeat: number;
    };
    results.push(row);
  }
  stmt.free();

  return results;
}

/**
 * Check if agent's heartbeat is current (within timeout)
 */
export function isAgentHeartbeatCurrent(db: Database, agentId: string, timeoutSeconds: number = 15): boolean {
  const query = `
    SELECT
      CASE
        WHEN last_seen IS NULL THEN 0
        WHEN (julianday('now') - julianday(last_seen)) * 86400 <= ? THEN 1
        ELSE 0
      END as is_current
    FROM agents
    WHERE id = ?
  `;

  const stmt = db.prepare(query);
  stmt.bind([timeoutSeconds, agentId]);

  let isCurrent = false;
  if (stmt.step()) {
    const row = stmt.getAsObject() as { is_current: number };
    isCurrent = row.is_current === 1;
  }
  stmt.free();

  return isCurrent;
}
