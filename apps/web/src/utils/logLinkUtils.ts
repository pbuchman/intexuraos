/**
 * URL segment identified within a log line.
 */
export interface URLSegment {
  type: 'url';
  url: string;
}

export type LogSegment = string | URLSegment;

/**
 * Regex matching HTTP/HTTPS URLs in log text.
 * Stops at whitespace and common delimiter characters that are unlikely to be
 * part of a URL in log output.
 */
const LOG_URL_RE = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

/**
 * Sentence-ending punctuation stripped from the URL and consumed (not re-emitted
 * as a trailing text segment).
 */
const CONSUME_TRAIL_RE = /[.,;:!?]+$/;

/**
 * Closing brackets stripped from the URL but kept in the text stream as a
 * trailing text segment (e.g. prose parentheses around a URL).
 */
const KEEP_TRAIL_RE = /[)]+$/;

function cleanUrl(rawUrl: string): string {
  // Strip closing brackets first (they remain in the text stream).
  const withoutBrackets = rawUrl.replace(KEEP_TRAIL_RE, '');
  // Then strip sentence-ending punctuation (consumed, not re-emitted).
  return withoutBrackets.replace(CONSUME_TRAIL_RE, '');
}

/**
 * Return how many characters past `url` should be consumed (not re-emitted).
 * Closing brackets are kept in the text stream; sentence punctuation is consumed.
 */
function consumeLength(rawUrl: string, url: string): number {
  const suffix = rawUrl.slice(url.length);
  // Remove closing brackets that should stay in the text stream.
  const consumed = suffix.replace(KEEP_TRAIL_RE, '');
  return url.length + consumed.length;
}

/**
 * Split a log line into plain text and URL segments.
 * Plain text segments are strings; URL segments are `{ type: 'url', url }`.
 */
export function parseLogLine(text: string): LogSegment[] {
  const segments: LogSegment[] = [];
  let lastIndex = 0;

  LOG_URL_RE.lastIndex = 0;
  let match = LOG_URL_RE.exec(text);

  while (match !== null) {
    const rawUrl = match[1] ?? match[0];
    const url = cleanUrl(rawUrl);
    const matchStart = match.index;
    // Advance lastIndex past the URL and any consumed trailing punctuation,
    // but not past closing brackets (they stay in the text stream).
    const advance = matchStart + consumeLength(rawUrl, url);

    if (matchStart > lastIndex) {
      segments.push(text.slice(lastIndex, matchStart));
    }

    segments.push({ type: 'url', url });
    lastIndex = advance;

    LOG_URL_RE.lastIndex = advance;
    match = LOG_URL_RE.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  if (segments.length === 0) {
    segments.push('');
  }

  return segments;
}

const MAX_DISPLAY_LENGTH = 80;
const PREFIX_LENGTH = 40;
const SUFFIX_LENGTH = 30;

/**
 * Truncate long URLs for display.
 * URLs <= 80 chars are returned as-is.
 * Longer URLs show first 40 + "…" + last 30 characters.
 */
export function formatUrlForDisplay(url: string): string {
  if (url.length <= MAX_DISPLAY_LENGTH) return url;
  return url.slice(0, PREFIX_LENGTH) + '…' + url.slice(-SUFFIX_LENGTH);
}
