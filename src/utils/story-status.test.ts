// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { STORY_STATUS_ORDER, isForwardTransition, isStatusRegression } from './story-status.js';

describe('STORY_STATUS_ORDER', () => {
  it('contains all expected statuses in order', () => {
    expect(STORY_STATUS_ORDER).toEqual([
      'draft',
      'estimated',
      'planned',
      'in_progress',
      'review',
      'qa',
      'qa_failed',
      'pr_submitted',
      'merged',
    ]);
  });
});

describe('isStatusRegression', () => {
  it('detects regression to earlier status', () => {
    expect(isStatusRegression('in_progress', 'draft')).toBe(true);
    expect(isStatusRegression('merged', 'planned')).toBe(true);
    expect(isStatusRegression('review', 'estimated')).toBe(true);
  });

  it('returns false for forward transitions', () => {
    expect(isStatusRegression('draft', 'estimated')).toBe(false);
    expect(isStatusRegression('planned', 'in_progress')).toBe(false);
    expect(isStatusRegression('review', 'merged')).toBe(false);
  });

  it('returns false for same status', () => {
    expect(isStatusRegression('planned', 'planned')).toBe(false);
  });

  it('returns false for unknown statuses', () => {
    expect(isStatusRegression('unknown', 'planned')).toBe(false);
    expect(isStatusRegression('planned', 'unknown')).toBe(false);
  });
});

describe('isForwardTransition', () => {
  it('allows forward transitions', () => {
    expect(isForwardTransition('draft', 'estimated')).toBe(true);
    expect(isForwardTransition('estimated', 'planned')).toBe(true);
    expect(isForwardTransition('planned', 'in_progress')).toBe(true);
    expect(isForwardTransition('in_progress', 'review')).toBe(true);
    expect(isForwardTransition('review', 'pr_submitted')).toBe(true);
    expect(isForwardTransition('pr_submitted', 'qa')).toBe(true);
    expect(isForwardTransition('qa', 'merged')).toBe(true);
  });

  it('allows same-status (no-op)', () => {
    expect(isForwardTransition('planned', 'planned')).toBe(true);
    expect(isForwardTransition('in_progress', 'in_progress')).toBe(true);
  });

  it('prevents backward transitions', () => {
    expect(isForwardTransition('in_progress', 'planned')).toBe(false);
    expect(isForwardTransition('in_progress', 'draft')).toBe(false);
    expect(isForwardTransition('review', 'planned')).toBe(false);
    expect(isForwardTransition('merged', 'planned')).toBe(false);
    expect(isForwardTransition('qa', 'planned')).toBe(false);
  });

  it('handles qa_failed ordering correctly', () => {
    expect(isForwardTransition('review', 'qa_failed')).toBe(true);
    expect(isForwardTransition('in_progress', 'qa_failed')).toBe(true);
    expect(isForwardTransition('qa', 'qa_failed')).toBe(false);
  });
});
