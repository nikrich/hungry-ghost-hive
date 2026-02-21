// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { AgentRow, PullRequestRow } from '../../../db/client.js';

export interface FindOrphanedReviewAssignmentsInput {
  openPRs: PullRequestRow[];
  liveSessionNames: Set<string>;
  agentsBySessionName: Map<string, AgentRow>;
}

export interface OrphanedReviewAssignment {
  pr: PullRequestRow;
  reason: string;
}

export function findOrphanedReviewAssignments(
  input: FindOrphanedReviewAssignmentsInput
): OrphanedReviewAssignment[] {
  const orphaned: OrphanedReviewAssignment[] = [];

  for (const pr of input.openPRs) {
    if (pr.status !== 'reviewing') continue;

    const reviewer = pr.reviewed_by;
    if (!reviewer) {
      orphaned.push({
        pr,
        reason: 'PR is reviewing with no assigned reviewer',
      });
      continue;
    }

    if (input.liveSessionNames.has(reviewer)) {
      continue;
    }

    const mappedAgent = input.agentsBySessionName.get(reviewer);
    if (mappedAgent?.tmux_session && input.liveSessionNames.has(mappedAgent.tmux_session)) {
      continue;
    }

    if (mappedAgent?.status === 'terminated') {
      orphaned.push({
        pr,
        reason: `Reviewer ${reviewer} is terminated`,
      });
      continue;
    }

    orphaned.push({
      pr,
      reason: `Reviewer session ${reviewer} is not live`,
    });
  }

  return orphaned;
}
