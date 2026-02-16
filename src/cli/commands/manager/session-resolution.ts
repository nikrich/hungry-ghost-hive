// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { AgentRow } from '../../../db/client.js';
import type { TmuxSession } from '../../../tmux/manager.js';

type AgentSessionRef = Pick<AgentRow, 'id' | 'tmux_session'>;

export function findSessionForAgent(
  hiveSessions: TmuxSession[],
  agent: AgentSessionRef | undefined
): TmuxSession | undefined {
  if (!agent) return undefined;

  if (agent.tmux_session) {
    const configuredSession = hiveSessions.find(session => session.name === agent.tmux_session);
    if (configuredSession) {
      return configuredSession;
    }
  }

  const canonicalSession = hiveSessions.find(session => session.name === `hive-${agent.id}`);
  if (canonicalSession) {
    return canonicalSession;
  }

  // Backward-compatible fallback for older session naming schemes.
  return hiveSessions.find(session => session.name.includes(agent.id));
}
