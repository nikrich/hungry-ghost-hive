/**
 * Unified story ID validation and extraction utilities
 * Story IDs follow the pattern: STORY-<identifier>
 * Examples: STORY-IMP-003, STORY-REF-022, STORY-ABC123XYZ
 */

/**
 * Regex pattern for validating story IDs
 * Matches: STORY-<alphanumeric and hyphens>
 * Examples: STORY-IMP-003, STORY-REF-022, STORY-ABC123XYZ
 */
export const STORY_ID_PATTERN = /^STORY-[A-Z0-9]+(-[A-Z0-9]+)*$/i;

/**
 * Validate if a string is a valid story ID
 */
export function isValidStoryId(id: string | undefined | null): id is string {
  if (!id || typeof id !== 'string') return false;
  return STORY_ID_PATTERN.test(id);
}

/**
 * Extract story ID from a branch name
 * Supports patterns like: feature/STORY-001-description, STORY-REF-022, etc.
 */
export function extractStoryIdFromBranch(branchName: string): string | null {
  if (!branchName) return null;
  const match = branchName.match(STORY_ID_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Normalize a story ID to uppercase
 */
export function normalizeStoryId(id: string): string {
  return id.toUpperCase();
}
