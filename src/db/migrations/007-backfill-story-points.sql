-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 007: Backfill story_points from complexity_score
-- Story points never appear in Jira because the sync code only checks story_points,
-- which is always NULL. This migration populates story_points from complexity_score
-- for all existing stories where story_points is NULL and complexity_score is not NULL.

UPDATE stories
SET story_points = complexity_score
WHERE story_points IS NULL
  AND complexity_score IS NOT NULL;
