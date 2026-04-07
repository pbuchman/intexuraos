# Interactive Links in Code Task Logs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect HTTP/HTTPS URLs in code task execution logs and render them as clickable links that open in new tabs.

**Architecture:** A pure-utility `logLinkUtils.ts` splits log text into plain-text and URL segments. A `renderLogContent()` helper in `CodeTaskLogViewer.tsx` maps those segments to `<span>` and `<a>` elements. Tests cover the utility in isolation and the component rendering via `@testing-library/react`.

**Tech Stack:** React, TypeScript, Vitest, @testing-library/react, jsdom

---

## File Structure

| File                                                                      | Responsibility                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/utils/logLinkUtils.ts`                                      | **NEW** — URL regex, `parseLogLine()`, `formatUrlForDisplay()`              |
| `apps/web/src/utils/__tests__/logLinkUtils.test.ts`                       | **NEW** — Unit tests for URL parsing and formatting                         |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`                | **MODIFY** — Add `renderLogContent()` helper, use it in 3 `<pre>` locations |
| `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx` | **NEW** — Component integration tests for link rendering                    |

---

### Task 1: URL Detection Utility — Tests

**Files:**
- Create: `apps/web/src/utils/logLinkUtils.ts` (empty export scaffold)
- Create: `apps/web/src/utils/__tests__/logLinkUtils.test.ts`

- [ ] **Step 1: Create the utility scaffold**

Create `apps/web/src/utils/logLinkUtils.ts` with empty exported functions so the test file can import them:

```typescript
export interface URLSegment {
  type: 'url';
  url: string;
}

export type LogSegment = string | URLSegment;

export function parseLogLine(_text: string): LogSegment[] {
  return [_text];
}

export function formatUrlForDisplay(_url: string): string {
  return _url;
}
```

- [ ] **Step 2: Write failing tests for parseLogLine**

Create `apps/web/src/utils/__tests__/logLinkUtils.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseLogLine, formatUrlForDisplay } from '../logLinkUtils.js';
import type { URLSegment } from '../logLinkUtils.js';

describe('parseLogLine', () => {
  it('returns plain text when no URL is present', () => {
    const result = parseLogLine('[claude] Hello world');
    expect(result).toEqual(['[claude] Hello world']);
  });

  it('extracts a single HTTP URL', () => {
    const result = parseLogLine('Visit http://example.com for more');
    expect(result).toEqual([
      'Visit ',
      { type: 'url', url: 'http://example.com' },
      ' for more',
    ]);
  });

  it('extracts a single HTTPS URL', () => {
    const result = parseLogLine('See https://github.com/org/repo/pull/123');
    expect(result).toEqual([
      'See ',
      { type: 'url', url: 'https://github.com/org/repo/pull/123' },
    ]);
  });

  it('extracts multiple URLs from one line', () => {
    const result = parseLogLine('Links: https://a.com and https://b.com done');
    expect(result).toEqual([
      'Links: ',
      { type: 'url', url: 'https://a.com' },
      ' and ',
      { type: 'url', url: 'https://b.com' },
      ' done',
    ]);
  });

  it('handles URL at the start of the line', () => {
    const result = parseLogLine('https://start.com is the link');
    expect(result).toEqual([
      { type: 'url', url: 'https://start.com' },
      ' is the link',
    ]);
  });

  it('handles URL at the end of the line', () => {
    const result = parseLogLine('Go to https://end.com');
    expect(result).toEqual([
      'Go to ',
      { type: 'url', url: 'https://end.com' },
    ]);
  });

  it('handles URL with query parameters and fragments', () => {
    const result = parseLogLine('URL: https://example.com/path?q=1&r=2#section');
    expect(result).toEqual([
      'URL: ',
      { type: 'url', url: 'https://example.com/path?q=1&r=2#section' },
    ]);
  });

  it('returns single-element array for empty string', () => {
    const result = parseLogLine('');
    expect(result).toEqual(['']);
  });

  it('does not match non-http protocols', () => {
    const result = parseLogLine('Use ftp://files.example.com');
    expect(result).toEqual(['Use ftp://files.example.com']);
  });

  it('handles URL followed by punctuation that is not part of URL', () => {
    const result = parseLogLine('See https://example.com.');
    expect(result).toHaveLength(2);
    const urlSegment = result[1] as URLSegment;
    expect(urlSegment.type).toBe('url');
    // Trailing period should not be part of the URL
    expect(urlSegment.url).toBe('https://example.com');
  });

  it('handles URL with port number', () => {
    const result = parseLogLine('Server at http://localhost:3000/health');
    expect(result).toEqual([
      'Server at ',
      { type: 'url', url: 'http://localhost:3000/health' },
    ]);
  });

  it('handles URL inside prose parentheses', () => {
    const result = parseLogLine('(see https://example.com)');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('(see ');
    const urlSegment = result[1] as URLSegment;
    expect(urlSegment.url).toBe('https://example.com');
  });
});

describe('formatUrlForDisplay', () => {
  it('returns short URLs unchanged', () => {
    expect(formatUrlForDisplay('https://example.com')).toBe('https://example.com');
  });

  it('returns URLs at exactly 80 chars unchanged', () => {
    const url = 'https://example.com/' + 'a'.repeat(60);
    expect(url).toHaveLength(80);
    expect(formatUrlForDisplay(url)).toBe(url);
  });

  it('truncates URLs longer than 80 chars', () => {
    const url = 'https://example.com/' + 'a'.repeat(100);
    expect(url.length).toBeGreaterThan(80);
    const result = formatUrlForDisplay(url);
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(url.length);
  });

  it('shows first 40 + ellipsis + last 30 chars for long URLs', () => {
    const url = 'https://example.com/' + 'x'.repeat(100);
    const result = formatUrlForDisplay(url);
    expect(result.slice(0, 40)).toBe(url.slice(0, 40));
    expect(result.slice(-30)).toBe(url.slice(-30));
    expect(result).toContain('…');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter web exec vitest run src/utils/__tests__/logLinkUtils.test.ts`
Expected: Most tests FAIL because `parseLogLine` returns the input as-is and `formatUrlForDisplay` returns input unchanged.

---

### Task 2: URL Detection Utility — Implementation

**Files:**
- Modify: `apps/web/src/utils/logLinkUtils.ts`

- [ ] **Step 1: Implement parseLogLine and formatUrlForDisplay**

Replace the scaffold in `apps/web/src/utils/logLinkUtils.ts` with the real implementation:

```typescript
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
 * part of a URL in log output. Trailing punctuation (.,;:!?) is stripped when
 * not followed by a word character (avoids breaking query params like `q=1`).
 */
const LOG_URL_RE = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

/** Characters that commonly trail a URL in prose but aren't part of it. */
const TRAILING_PUNCT_RE = /[.,;:!?)]+$/;

function cleanTrailingPunct(rawUrl: string): string {
  const match = TRAILING_PUNCT_RE.exec(rawUrl);
  if (match === null) return rawUrl;
  // Keep trailing punctuation if preceded by a balanced paren (e.g., wiki URLs)
  // Simple heuristic: if the URL contains '(' and ends with ')', keep it
  if (rawUrl.endsWith(')') && rawUrl.includes('(')) return rawUrl;
  return rawUrl.slice(0, rawUrl.length - match[0].length);
}

/**
 * Split a log line into plain text and URL segments.
 * Plain text segments are strings; URL segments are `{ type: 'url', url }`.
 */
export function parseLogLine(text: string): LogSegment[] {
  const segments: LogSegment[] = [];
  let lastIndex = 0;

  // Reset regex state
  LOG_URL_RE.lastIndex = 0;
  let match = LOG_URL_RE.exec(text);

  while (match !== null) {
    const rawUrl = match[1] ?? match[0];
    const url = cleanTrailingPunct(rawUrl);
    const matchStart = match.index;
    const matchEnd = matchStart + url.length;

    if (matchStart > lastIndex) {
      segments.push(text.slice(lastIndex, matchStart));
    }

    segments.push({ type: 'url', url });
    lastIndex = matchEnd;

    // Advance regex past what we consumed (url may be shorter than rawUrl)
    LOG_URL_RE.lastIndex = matchEnd;
    match = LOG_URL_RE.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  // Guarantee at least one segment for empty strings
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /repo && pnpm --filter web exec vitest run src/utils/__tests__/logLinkUtils.test.ts`
Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/utils/logLinkUtils.ts apps/web/src/utils/__tests__/logLinkUtils.test.ts
git commit -m "feat(web): add logLinkUtils for URL detection in log lines"
```

---

### Task 3: CodeTaskLogViewer Component — Integration Tests

**Files:**
- Create: `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Create `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeTaskLogViewer } from '../CodeTaskLogViewer.js';
import type { LogLine } from '@/hooks/useCodeTaskLogs.js';

function makeLine(text: string, sequence = 0): LogLine {
  return { sequence, text };
}

// Suppress scrollTo in jsdom
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

describe('CodeTaskLogViewer link rendering', () => {
  const baseProps = {
    logs: [] as LogLine[],
    isActive: false,
    listenerHealthy: true,
    taskStatus: 'implemented' as const,
  };

  it('renders a single URL as a clickable link', () => {
    const logs = [makeLine('[claude] See https://github.com/org/repo')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const link = screen.getByRole('link', { name: /github\.com/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/org/repo');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders multiple URLs in a single log line', () => {
    const logs = [makeLine('Links: https://a.com and https://b.com end')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://a.com');
    expect(links[1]).toHaveAttribute('href', 'https://b.com');
  });

  it('renders plain text without links when no URL present', () => {
    const logs = [makeLine('[claude] No links here')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/No links here/)).toBeInTheDocument();
  });

  it('truncates long URLs in display text but keeps full URL in href', () => {
    const longPath = 'a'.repeat(100);
    const fullUrl = `https://example.com/${longPath}`;
    const logs = [makeLine(`Check ${fullUrl}`)];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', fullUrl);
    // Display text should be truncated (contains ellipsis)
    expect(link.textContent?.length).toBeLessThan(fullUrl.length);
  });

  it('applies correct CSS classes to links', () => {
    const logs = [makeLine('[tool] Output at https://example.com')];
    render(<CodeTaskLogViewer {...baseProps} logs={logs} />);

    const link = screen.getByRole('link');
    expect(link.className).toContain('text-blue-600');
    expect(link.className).toContain('underline');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /repo && pnpm --filter web exec vitest run src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`
Expected: FAIL — links are not rendered yet (plain text in `<pre>` elements).

---

### Task 4: CodeTaskLogViewer Component — Implementation

**Files:**
- Modify: `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`

- [ ] **Step 1: Add import and renderLogContent helper**

At the top of `CodeTaskLogViewer.tsx`, add the import:

```typescript
import { parseLogLine, formatUrlForDisplay } from '@/utils/logLinkUtils.js';
```

Add a `renderLogContent` helper function before the `CodeTaskLogViewer` component (after `countVisualLines`):

```tsx
function renderLogContent(text: string): React.ReactNode {
  const segments = parseLogLine(text);
  if (segments.length === 1 && typeof segments[0] === 'string') {
    return text;
  }
  return segments.map((segment, i) => {
    if (typeof segment === 'string') {
      return <span key={i}>{segment}</span>;
    }
    return (
      <a
        key={i}
        href={segment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300"
      >
        {formatUrlForDisplay(segment.url)}
      </a>
    );
  });
}
```

- [ ] **Step 2: Replace plain text rendering in 3 locations**

**Location 1 — Main log line (line ~370-372):**

Replace:
```tsx
<pre className={`min-w-0 ${claudeFilter ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${getLogLineClass(line.text)}`}>
  {line.text}
</pre>
```
With:
```tsx
<pre className={`min-w-0 ${claudeFilter ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${getLogLineClass(line.text)}`}>
  {renderLogContent(line.text)}
</pre>
```

**Location 2 — Body lines (line ~390-392):**

Replace:
```tsx
<pre className={`whitespace-pre rounded px-2 py-0.5 ${getLogLineClass(bodyLine.text)}`}>
  {bodyLine.text}
</pre>
```
With:
```tsx
<pre className={`whitespace-pre rounded px-2 py-0.5 ${getLogLineClass(bodyLine.text)}`}>
  {renderLogContent(bodyLine.text)}
</pre>
```

Note: The collapsed toggle button (location 3 in the plan doc) shows line count text like "N lines hidden", not log content, so it does not need link rendering.

- [ ] **Step 3: Run integration tests to verify they pass**

Run: `cd /repo && pnpm --filter web exec vitest run src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx`
Expected: ALL tests PASS.

- [ ] **Step 4: Run all web tests**

Run: `cd /repo && pnpm run verify:workspace:tracked -- web`
Expected: All tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx
git commit -m "feat(web): render interactive links in code task log viewer"
```

---

### Task 5: Full CI Verification

- [ ] **Step 1: Build all packages**

Run: `cd /repo && pnpm build`
Expected: Build succeeds.

- [ ] **Step 2: Run full CI**

Run: `cd /repo && pnpm run ci:tracked`
Expected: ALL checks pass.
