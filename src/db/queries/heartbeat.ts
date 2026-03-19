// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../provider.js';

/** Default timeout in seconds for considering an agent stale */
const DEFAULT_STALE_TIMEOUT_SECONDS = 15;

/**
 * Update agent's last_seen timestamp (heartbeat)
 */
export function updateAgentHeartbeat(provider: DatabaseProvider, agentId: string): void {
  provider.run('UPDATE agents SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [agentId]);
}

/**
 * Get agents that haven't sent a heartbeat within the specified timeout (in seconds)
 */
export function getStaleAgents(
  provider: DatabaseProvider,
  timeoutSeconds: number = DEFAULT_STALE_TIMEOUT_SECONDS
): Array<{
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

  return provider.queryAll<{
    id: string;
    type: string;
    status: string;
    last_seen: string | null;
    seconds_since_heartbeat: number;
  }>(query, [timeoutSeconds, timeoutSeconds]);
}

/**
 * Check if agent's heartbeat is current (within timeout)
 */
export function isAgentHeartbeatCurrent(
  provider: DatabaseProvider,
  agentId: string,
  timeoutSeconds: number = DEFAULT_STALE_TIMEOUT_SECONDS
): boolean {
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

  const row = provider.queryOne<{ is_current: number }>(query, [timeoutSeconds, agentId]);
  return row?.is_current === 1;
}
