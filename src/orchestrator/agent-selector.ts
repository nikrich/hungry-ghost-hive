// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../db/provider.js';
// import { queryOne } from '../db/client.js' — removed (using provider methods);
import type { AgentRow } from '../db/queries/agents.js';

/**
 * Select the agent with the least workload (queue-depth aware).
 * Returns the agent with fewest active stories; breaks ties by creation order.
 */
export function selectAgentWithLeastWorkload(db: DatabaseProvider, agents: AgentRow[]): AgentRow {
  let selectedAgent = agents[0];
  let minWorkload = getAgentWorkload(db, selectedAgent.id);

  for (let i = 1; i < agents.length; i++) {
    const workload = getAgentWorkload(db, agents[i].id);
    if (workload < minWorkload) {
      minWorkload = workload;
      selectedAgent = agents[i];
    }
  }

  return selectedAgent;
}

/**
 * Calculate queue depth for an agent (number of active stories).
 */
export function getAgentWorkload(db: DatabaseProvider, agentId: string): number {
  const result = db.queryOne<{ count: number }>(
    `
    SELECT COUNT(*) as count FROM stories
    WHERE assigned_agent_id = ?
      AND status IN ('in_progress', 'review', 'qa', 'qa_failed')
  `,
    [agentId]
  );
  return result?.count || 0;
}
