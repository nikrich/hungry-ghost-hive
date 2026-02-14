// Licensed under the Hungry Ghost Hive License. See LICENSE.

const MANUAL_MERGE_REQUIRED_MARKER = '[manual-merge-required]';

/**
 * Mark review notes as requiring manual merge. Used by `hive pr approve --no-merge`
 * so daemon auto-merge can skip these PRs.
 */
export function markManualMergeRequired(notes?: string | null): string {
  const trimmed = notes?.trim() ?? '';
  if (trimmed.includes(MANUAL_MERGE_REQUIRED_MARKER)) {
    return trimmed;
  }
  if (trimmed.length === 0) {
    return MANUAL_MERGE_REQUIRED_MARKER;
  }
  return `${MANUAL_MERGE_REQUIRED_MARKER}\n${trimmed}`;
}

/**
 * Check whether review notes indicate that this PR must be merged manually.
 */
export function isManualMergeRequired(notes?: string | null): boolean {
  return Boolean(notes && notes.includes(MANUAL_MERGE_REQUIRED_MARKER));
}
