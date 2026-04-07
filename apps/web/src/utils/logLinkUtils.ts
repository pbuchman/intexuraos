/**
 * Utility for detecting and parsing URLs in code task log lines.
 */

export const LOG_URL_RE = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

export interface URLSegment {
  type: 'url';
  url: string;
}

const TRAILING_PUNCTUATION = new Set(['.', ',', ')', ';', "'"] as const);

function stripTrailingPunctuation(url: string): string {
  let result = url;
  while (result.length > 0 && TRAILING_PUNCTUATION.has(result[result.length - 1] as '.')) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Splits a log line into plain text segments and URL segments.
 * URL segments have `type: 'url'` and the full `url` string.
 * Trailing punctuation characters (`.`, `,`, `)`, `;`, `'`) are stripped from URLs.
 * Empty strings are filtered from the output.
 */
export function parseLogLine(text: string): (string | URLSegment)[] {
  const segments: (string | URLSegment)[] = [];
  let lastIndex = 0;
  const regex = new RegExp(LOG_URL_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawUrl = match[0];
    const cleanUrl = stripTrailingPunctuation(rawUrl);
    const strippedCount = rawUrl.length - cleanUrl.length;
    const matchStart = match.index;
    const matchEnd = matchStart + rawUrl.length;

    const before = text.slice(lastIndex, matchStart);
    if (before !== '') {
      segments.push(before);
    }

    if (cleanUrl !== '') {
      segments.push({ type: 'url', url: cleanUrl });
    }

    // The stripped punctuation belongs back to the surrounding text
    if (strippedCount > 0) {
      // We advance lastIndex to end of clean URL; trailing punctuation will be
      // picked up as plain text in the next iteration's "before" slice.
      lastIndex = matchEnd - strippedCount;
    } else {
      lastIndex = matchEnd;
    }

    // Adjust regex to continue from lastIndex
    regex.lastIndex = lastIndex;
  }

  const tail = text.slice(lastIndex);
  if (tail !== '') {
    segments.push(tail);
  }

  return segments;
}

/**
 * Truncates URLs longer than 80 chars for display,
 * showing first 40 + `...` + last 30 characters.
 */
export function formatUrlForDisplay(url: string): string {
  if (url.length <= 80) {
    return url;
  }
  return url.slice(0, 40) + '...' + url.slice(-30);
}
