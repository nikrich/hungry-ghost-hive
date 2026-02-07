/**
 * Unified story ID validation and extraction utilities
 * Story IDs follow the pattern: STORY-<identifier>
 * Examples: STORY-IMP-003, STORY-REF-022, STORY-ABC123XYZ
 */

/**
 * Regex pattern for extracting story IDs from branch names
 * Matches: STORY-<alphanumeric and hyphens>
 * Examples: STORY-IMP-003, STORY-REF-022, STORY-ABC123XYZ
 */
export const STORY_ID_PATTERN = /STORY-[A-Z0-9]+(-[A-Z0-9]+)*/i;

/**
 * Validate if a string is a valid story ID
 */
export function isValidStoryId(id: string | undefined | null): id is string {
  if (!id || typeof id !== 'string') return false;
  return /^STORY-[A-Z0-9]+(-[A-Z0-9]+)*$/i.test(id);
}

/**
 * Extract story ID from a branch name
 * Supports patterns like: feature/STORY-001-description, STORY-REF-022, etc.
 * The function extracts the story ID and removes any trailing segments that look like descriptions
 * (segments containing lowercase letters that aren't pure digits or uppercase)
 */
export function extractStoryIdFromBranch(branchName: string): string | null {
  if (!branchName) return null;
  const match = branchName.match(STORY_ID_PATTERN);
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
