/**
 * Extract GitHub PR number from a GitHub PR URL
 * @param url GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)
 * @returns PR number or undefined if URL is invalid
 */
export function extractPRNumber(url: string): number | undefined {
  try {
    // Match GitHub PR URLs like https://github.com/owner/repo/pull/123
    // Ensure it's a GitHub URL and has the /pull/number pattern
    const match = url.match(/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)(?:[?#]|$)/);
    return match ? parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}
