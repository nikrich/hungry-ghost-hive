// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { isManualMergeRequired, markManualMergeRequired } from './manual-merge.js';

describe('manual merge review note marker', () => {
  it('marks empty notes as manual-merge-required', () => {
    expect(markManualMergeRequired()).toBe('[manual-merge-required]');
    expect(isManualMergeRequired(markManualMergeRequired())).toBe(true);
  });

  it('preserves existing notes while adding marker once', () => {
    const notes = markManualMergeRequired('Needs human verification');
    expect(notes).toContain('[manual-merge-required]');
    expect(notes).toContain('Needs human verification');
    expect(markManualMergeRequired(notes)).toBe(notes);
  });

  it('does not detect marker in normal notes', () => {
    expect(isManualMergeRequired('Looks good')).toBe(false);
  });
});
