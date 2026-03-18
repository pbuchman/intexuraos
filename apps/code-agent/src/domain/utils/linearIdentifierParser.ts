/**
 * Utilities for extracting Linear issue identifiers from URLs and text.
 *
 * Moved from webhookRoutes.ts to avoid circular imports (webhookRoutes -> usecases -> webhookRoutes).
 */

/**
 * Parse a Linear issue identifier (e.g. "INT-123") from a Linear URL or markdown link.
 *
 * Accepts:
 *  - Plain URL: https://linear.app/pbuchman/issue/INT-123/some-title
 *  - Markdown link: [INT-123](https://linear.app/pbuchman/issue/INT-123/some-title)
 *
 * Returns the identifier string or null if not a valid Linear issue URL.
 */
export const parseLinearIdentifierFromUrl = (url: string): string | null => {
  const mdMatch = /\[.*?\]\((.*?)\)/.exec(url);
  const cleanUrl = mdMatch?.[1] ?? url;

  try {
    const parsed = new URL(cleanUrl);
    if (parsed.hostname !== 'linear.app') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const identifier = segments[2];
    if (segments.length < 3 || segments[1] !== 'issue' || identifier === undefined) return null;
    return identifier;
  } catch {
    return null;
  }
};

/**
 * Extract the first Linear issue identifier from free-form text (e.g. a PR body).
 *
 * Scans for Linear URLs (plain or markdown) and returns the first valid identifier found.
 * Returns null if no Linear URL is found in the text.
 */
export function extractLinearIdentifierFromText(text: string): string | null {
  // Match markdown links with linear.app URLs or plain linear.app URLs
  const urlPattern = /(?:\[.*?\]\(https?:\/\/linear\.app\/[^)]+\)|https?:\/\/linear\.app\/\S+)/g;
  let match: RegExpExecArray | null = urlPattern.exec(text);
  while (match !== null) {
    const identifier = parseLinearIdentifierFromUrl(match[0]);
    if (identifier !== null) {
      return identifier;
    }
    match = urlPattern.exec(text);
  }
  return null;
}
