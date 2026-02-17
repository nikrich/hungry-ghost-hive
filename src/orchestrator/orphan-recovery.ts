// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type Database from 'better-sqlite3';
import { syncStatusForStory } from '../connectors/project-management/operations.js';
import { createLog } from '../db/queries/logs.js';
import {
  getStaleInProgressStoriesWithoutAssignment,
  getStoriesWithOrphanedAssignments,
  updateStory,
} from '../db/queries/stories.js';

/**
 * Detect and recover orphaned stories (assigned to terminated agents).
 * Returns the story IDs that were recovered.
 */
export function detectAndRecoverOrphanedStories(db: Database.Database, rootDir: string): string[] {
  const orphanedAssignments = getStoriesWithOrphanedAssignments(db);
  const staleInProgressStories = getStaleInProgressStoriesWithoutAssignment(db);
  const recovered: string[] = [];
  const recoveredSet = new Set<string>();

  for (const assignment of orphanedAssignments) {
    try {
      if (recoveredSet.has(assignment.id)) continue;

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
      recoveredSet.add(assignment.id);

      // Sync status change to Jira (fire and forget)
      syncStatusForStory(rootDir, db, assignment.id, 'planned');
    } catch (err) {
      console.error(
        `Failed to recover orphaned story ${assignment.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  for (const story of staleInProgressStories) {
    try {
      if (recoveredSet.has(story.id)) continue;

      updateStory(db, story.id, {
        assignedAgentId: null,
        status: 'planned',
      });
      createLog(db, {
        agentId: 'scheduler',
        storyId: story.id,
        eventType: 'ORPHANED_STORY_RECOVERED',
        message: 'Recovered stale in_progress story with no assigned agent',
      });
      recovered.push(story.id);
      recoveredSet.add(story.id);

      // Sync status change to Jira (fire and forget)
      syncStatusForStory(rootDir, db, story.id, 'planned');
    } catch (err) {
      console.error(
        `Failed to recover stale story ${story.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return recovered;
}
