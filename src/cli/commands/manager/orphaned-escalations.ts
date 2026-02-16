// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Manager-created human-approval escalations use tmux session names (e.g. hive-junior-team-2)
 * in from_agent_id. These should be auto-resolved when the originating session is gone and
 * its mapped agent is terminated (or no longer exists).
 */
export function shouldAutoResolveOrphanedManagerEscalation(
  fromAgentId: string | null,
  activeSessionNames: Set<string>,
  agentStatusBySessionName: Map<string, string>
): boolean {
  if (!fromAgentId || !fromAgentId.startsWith('hive-')) {
    return false;
  }

  if (activeSessionNames.has(fromAgentId)) {
    return false;
  }

  const status = agentStatusBySessionName.get(fromAgentId);
  if (status && status !== 'terminated') {
    return false;
  }

  return true;
}
