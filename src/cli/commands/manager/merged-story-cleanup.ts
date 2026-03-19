// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { DatabaseProvider } from '../../../db/provider.js';
import { updateAgent } from '../../../db/queries/agents.js';

const ACTIVE_STORY_STATUS_ORDER: ReadonlyArray<{
  status: 'in_progress' | 'review' | 'qa' | 'qa_failed' | 'pr_submitted' | 'planned' | 'estimated';
  priority: number;
}> = [
  { status: 'in_progress', priority: 0 },
  { status: 'review', priority: 1 },
  { status: 'qa', priority: 2 },
  { status: 'qa_failed', priority: 3 },
  { status: 'pr_submitted', priority: 4 },
  { status: 'planned', priority: 5 },
  { status: 'estimated', priority: 6 },
];

function buildActiveStatusPriorityCase(): string {
  const clauses = ACTIVE_STORY_STATUS_ORDER.map(
    item => `WHEN '${item.status}' THEN ${item.priority}`
  ).join(' ');
  return `CASE status ${clauses} ELSE 99 END`;
}

async function getNextAssignedActiveStoryId(
  db: DatabaseProvider,
  agentId: string,
  mergedStoryId: string
): Promise<string | null> {
  const statusPriorityCase = buildActiveStatusPriorityCase();
  const row = await db.queryOne<{ id: string }>(
    `
      SELECT id
      FROM stories
      WHERE assigned_agent_id = ?
        AND id != ?
        AND status IN ('estimated', 'planned', 'in_progress', 'review', 'qa', 'qa_failed', 'pr_submitted')
      ORDER BY ${statusPriorityCase}, updated_at DESC
      LIMIT 1
    `,
    [agentId, mergedStoryId]
  );
  return row?.id ?? null;
}

export interface MergedStoryCleanupResult {
  cleared: number;
  reassigned: number;
}

export async function cleanupAgentsReferencingMergedStory(
  db: DatabaseProvider,
  mergedStoryId: string
): Promise<MergedStoryCleanupResult> {
  const staleAgents = await db.queryAll<{ id: string }>(
    `
      SELECT id
      FROM agents
      WHERE status != 'terminated'
        AND current_story_id = ?
    `,
    [mergedStoryId]
  );

  let cleared = 0;
  let reassigned = 0;

  for (const agent of staleAgents) {
    const nextStoryId = await getNextAssignedActiveStoryId(db, agent.id, mergedStoryId);
    await updateAgent(db, agent.id, {
      currentStoryId: nextStoryId,
      status: nextStoryId ? 'working' : 'idle',
    });
    cleared++;
    if (nextStoryId) reassigned++;
  }

  return { cleared, reassigned };
}
