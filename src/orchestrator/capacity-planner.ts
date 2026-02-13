// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { ScalingConfig } from '../config/schema.js';
import type { StoryRow } from '../db/queries/stories.js';

/** Minimum refactor budget points when capacity is low */
const MIN_REFACTOR_BUDGET_POINTS = 1;

/**
 * Convention-based story typing: refactor stories start with "Refactor:".
 */
export function isRefactorStory(story: StoryRow): boolean {
  return /^refactor\s*:/i.test(story.title.trim());
}

/**
 * Capacity computations prefer story points, then complexity score, then 1.
 */
export function getCapacityPoints(story: StoryRow): number {
  return story.story_points || story.complexity_score || 1;
}

/**
 * Apply configurable refactor-capacity policy before assignment.
 */
export function selectStoriesForCapacity(
  stories: StoryRow[],
  scalingConfig: ScalingConfig
): StoryRow[] {
  const refactorConfig = scalingConfig.refactor || {
    enabled: false,
    capacity_percent: 0,
    allow_without_feature_work: false,
  };

  if (!refactorConfig.enabled) {
    return stories.filter(story => !isRefactorStory(story));
  }

  const featureStories = stories.filter(story => !isRefactorStory(story));
  const featurePoints = featureStories.reduce((sum, story) => sum + getCapacityPoints(story), 0);
  const hasFeatureWork = featureStories.length > 0;

  if (!hasFeatureWork && !refactorConfig.allow_without_feature_work) {
    return [];
  }

  let refactorBudgetPoints = hasFeatureWork
    ? Math.floor((featurePoints * refactorConfig.capacity_percent) / 100)
    : Number.POSITIVE_INFINITY;

  if (hasFeatureWork && refactorConfig.capacity_percent > 0 && refactorBudgetPoints === 0) {
    refactorBudgetPoints = MIN_REFACTOR_BUDGET_POINTS;
  }

  let usedRefactorPoints = 0;
  const selected: StoryRow[] = [];

  for (const story of stories) {
    if (!isRefactorStory(story)) {
      selected.push(story);
      continue;
    }

    const points = getCapacityPoints(story);
    if (usedRefactorPoints + points > refactorBudgetPoints) {
      continue;
    }

    selected.push(story);
    usedRefactorPoints += points;
  }

  return selected;
}
