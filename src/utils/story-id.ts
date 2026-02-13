// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Unified story ID validation and extraction utilities
 * Story IDs follow the pattern: PREFIX-<identifier>
 * where PREFIX is 2+ uppercase letters (STORY, CONN, HT, INFRA, etc.)
 * Examples: STORY-IMP-003, CONN-008, HT-001, INFRA-042
 */

/**
 * Case-sensitive pattern matching any uppercase-letter prefix (2+ chars)
 * followed by uppercase-alphanumeric segments separated by hyphens.
 * Naturally stops at description segments (which contain lowercase letters).
 * Examples: CONN-003, STORY-FIX-004, HT-001
 */
export const STORY_ID_PATTERN = /[A-Z]{2,}-[A-Z0-9]+(-[A-Z0-9]+)*/;

/**
 * Legacy case-insensitive pattern for STORY- prefix only.
 * Used as a fallback when branch names contain lowercase story IDs.
 */
const LEGACY_STORY_PATTERN = /STORY-[A-Z0-9]+(-[A-Z0-9]+)*/i;

/**
 * Validate if a string is a valid story ID
 */
export function isValidStoryId(id: string | undefined | null): id is string {
  if (!id || typeof id !== 'string') return false;
  return /^[A-Z]{2,}-[A-Z0-9]+(-[A-Z0-9]+)*$/i.test(id);
}

/**
 * Extract story ID from a branch name
 * Supports patterns like: feature/CONN-003-description, feature/STORY-001-test, HT-001, etc.
 * First tries the case-sensitive general pattern (matches any uppercase prefix),
 * then falls back to the legacy case-insensitive STORY- pattern.
 * Removes any trailing segments that look like descriptions.
 */
export function extractStoryIdFromBranch(branchName: string): string | null {
  if (!branchName) return null;
  // Try legacy STORY- pattern first (case-insensitive) for backward compatibility,
  // then fall back to general pattern for non-STORY prefixes (CONN-, HT-, INFRA-, etc.)
  const match = branchName.match(LEGACY_STORY_PATTERN) || branchName.match(STORY_ID_PATTERN);
  if (!match) return null;

  // Get the original matched text (preserving case)
  const matchedText = match[0];
  const matchStart = branchName.indexOf(matchedText);

  // Split the matched text into segments
  const segments = matchedText.split('-');

  // Find where the story ID actually ends
  // It ends before a segment that looks like a description (contains lowercase and isn't purely numeric)
  let endSegmentIdx = segments.length;
  let currentPos = matchStart;

  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      currentPos += 1; // account for the dash
    }
    const segment = branchName.substring(currentPos, currentPos + segments[i].length);
    currentPos += segments[i].length;

    // Story ID segments are typically:
    // - First segment: "STORY" (or "story", "Story" due to case-insensitive match)
    // - Following segments: uppercase letters, digits, or pure digits
    // Description segments contain lowercase letters mixed with other characters (not pure digits)
    const isDescriptionLike =
      i > 0 && // Not the first segment
      /[a-z]/.test(segment) && // Contains lowercase
      !/^\d+$/.test(segment); // Not pure digits

    if (isDescriptionLike) {
      endSegmentIdx = i;
      break;
    }
  }

  // Reconstruct the story ID from the valid segments
  const storyIdParts = segments.slice(0, endSegmentIdx);
  const storyId = storyIdParts.join('-').toUpperCase();

  return storyId;
}

/**
 * Normalize a story ID to uppercase
 */
export function normalizeStoryId(id: string): string {
  return id.toUpperCase();
}
