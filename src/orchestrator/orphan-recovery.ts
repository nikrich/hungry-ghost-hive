// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Database } from 'sql.js';
import { createLog } from '../db/queries/logs.js';
import { getStoriesWithOrphanedAssignments, updateStory } from '../db/queries/stories.js';
import { syncStatusToJira } from '../integrations/jira/transitions.js';

/**
 * Detect and recover orphaned stories (assigned to terminated agents).
 * Returns the story IDs that were recovered.
 */
export function detectAndRecoverOrphanedStories(db: Database, rootDir: string): string[] {
  const orphanedAssignments = getStoriesWithOrphanedAssignments(db);
  const recovered: string[] = [];

  for (const assignment of orphanedAssignments) {
    try {
      // Update story in single atomic operation
      updateStory(db, assignment.id, {
        assignedAgentId: null,
        status: 'planned',
      });
      createLog(db, {
        agentId: 'scheduler',
        storyId: assignment.id,
        eventType: 'ORPHANED_STORY_RECOVERED',
        message: `Recovered from terminated agent ${assignment.agent_id}`,
      });
      recovered.push(assignment.id);

      // Sync status change to Jira (fire and forget)
      syncStatusToJira(rootDir, db, assignment.id, 'planned');
    } catch (err) {
      console.error(
        `Failed to recover orphaned story ${assignment.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return recovered;
}
