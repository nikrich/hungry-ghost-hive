// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Ordered lifecycle stages for Hive stories.
 * Used to prevent bidirectional sync from regressing story status
 * and to determine canonical status during cluster story merges.
 */
export const STORY_STATUS_ORDER = [
  'draft',
  'estimated',
  'planned',
  'in_progress',
  'review',
  'qa',
  'qa_failed',
  'pr_submitted',
  'merged',
] as const;

export type StoryStatusValue = (typeof STORY_STATUS_ORDER)[number];

/**
 * Status progression order for the Hive pipeline.
 * Higher numbers represent further progress. Used to prevent
 * sync from regressing stories backward.
 *
 * Note: qa_failed has the same order as review (4) because it
 * represents a lateral step, not a regression.
 */
const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  estimated: 1,
  planned: 2,
  in_progress: 3,
  review: 4,
  pr_submitted: 5,
  qa: 6,
  qa_failed: 4, // allowed as a backward step from qa
  merged: 7,
};

/**
 * Check if transitioning from currentStatus to newStatus would be a regression.
 * Returns true if the new status is earlier in the lifecycle than the current one.
 * Unknown statuses are allowed through (returns false).
 */
export function isStatusRegression(currentStatus: string, newStatus: string): boolean {
  const currentIdx = STORY_STATUS_ORDER.indexOf(currentStatus as StoryStatusValue);
  const newIdx = STORY_STATUS_ORDER.indexOf(newStatus as StoryStatusValue);
  if (currentIdx === -1 || newIdx === -1) return false;
  return newIdx < currentIdx;
}

/**
 * Check whether transitioning from currentStatus to newStatus is a
 * forward (or lateral) move in the pipeline.
 */
export function isForwardTransition(currentStatus: string, newStatus: string): boolean {
  const currentOrder = STATUS_ORDER[currentStatus] ?? -1;
  const newOrder = STATUS_ORDER[newStatus] ?? -1;
  return newOrder >= currentOrder;
}
