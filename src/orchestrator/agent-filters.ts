// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { AgentRow } from '../db/queries/agents.js';

export type AgentType = AgentRow['type'];

/**
 * Filter agents to only those that are assignable for story work:
 * non-qa, non-auditor, and either idle or working without a current story.
 */
export function getAssignableAgents(agents: AgentRow[]): AgentRow[] {
  return agents.filter(
    a =>
      a.type !== 'qa' &&
      a.type !== 'auditor' &&
      (a.status === 'idle' || (a.status === 'working' && a.current_story_id === null))
  );
}

/**
 * Filter agents by type, excluding terminated agents.
 */
export function getActiveOfType(agents: AgentRow[], type: AgentType): AgentRow[] {
  return agents.filter(a => a.type === type && a.status !== 'terminated');
}

/**
 * Filter agents by type with idle status.
 */
export function getIdleOfType(agents: AgentRow[], type: AgentType): AgentRow[] {
  return agents.filter(a => a.type === type && a.status === 'idle');
}

/**
 * Count existing agents of a given type (regardless of status).
 */
export function countOfType(agents: AgentRow[], type: AgentType): number {
  return agents.filter(a => a.type === type).length;
}
