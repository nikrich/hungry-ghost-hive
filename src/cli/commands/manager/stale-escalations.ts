// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { EscalationRow } from '../../../db/client.js';
import type { getAllAgents } from '../../../db/queries/agents.js';

type AgentRecord = ReturnType<typeof getAllAgents>[number];

export interface FindStaleSessionEscalationsInput {
  pendingEscalations: EscalationRow[];
  agents: AgentRecord[];
  liveSessionNames: Set<string>;
  nowMs: number;
  staleAfterMs: number;
}

export interface StaleSessionEscalation {
  escalation: EscalationRow;
  reason: string;
}

function buildAgentIndexes(agents: AgentRecord[]): {
  byId: Map<string, AgentRecord>;
  bySession: Map<string, AgentRecord>;
  byCanonicalSession: Map<string, AgentRecord>;
} {
  const byId = new Map<string, AgentRecord>();
  const bySession = new Map<string, AgentRecord>();
  const byCanonicalSession = new Map<string, AgentRecord>();

  for (const agent of agents) {
    byId.set(agent.id, agent);
    byCanonicalSession.set(`hive-${agent.id}`, agent);
    if (agent.tmux_session) {
      bySession.set(agent.tmux_session, agent);
    }
  }

  return { byId, bySession, byCanonicalSession };
}

function getEscalationAgeMs(escalation: EscalationRow, nowMs: number): number {
  const createdAtMs = Date.parse(escalation.created_at);
  if (Number.isNaN(createdAtMs)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, nowMs - createdAtMs);
}

function hasAnyLiveAgentSession(agent: AgentRecord, liveSessionNames: Set<string>): boolean {
  if (agent.tmux_session && liveSessionNames.has(agent.tmux_session)) {
    return true;
  }

  if (liveSessionNames.has(`hive-${agent.id}`)) {
    return true;
  }

  return liveSessionNames.has(agent.id);
}

export function findStaleSessionEscalations(
  input: FindStaleSessionEscalationsInput
): StaleSessionEscalation[] {
  const staleEscalations: StaleSessionEscalation[] = [];
  const { byId, bySession, byCanonicalSession } = buildAgentIndexes(input.agents);

  for (const escalation of input.pendingEscalations) {
    const source = escalation.from_agent_id;
    if (!source) continue;

    const ageMs = getEscalationAgeMs(escalation, input.nowMs);
    if (ageMs < input.staleAfterMs) continue;

    if (input.liveSessionNames.has(source)) {
      continue;
    }

    const sourceAgent = byId.get(source) || bySession.get(source) || byCanonicalSession.get(source);
    if (!sourceAgent) {
      staleEscalations.push({
        escalation,
        reason: `source session/agent "${source}" no longer exists`,
      });
      continue;
    }

    if (sourceAgent.status === 'terminated') {
      staleEscalations.push({
        escalation,
        reason: `source agent "${sourceAgent.id}" is terminated`,
      });
      continue;
    }

    if (!hasAnyLiveAgentSession(sourceAgent, input.liveSessionNames)) {
      staleEscalations.push({
        escalation,
        reason: `source agent "${sourceAgent.id}" has no live tmux session`,
      });
    }
  }

  return staleEscalations;
}
