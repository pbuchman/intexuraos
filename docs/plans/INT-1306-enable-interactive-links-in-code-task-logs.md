# INT-1306: Enable Interactive Links in Code Task Logs

## Overview

Code task execution logs may contain HTTP/HTTPS URLs, but they are currently rendered as plain text in `<pre>` elements, making them non-clickable. This task detects URLs in log text and renders them as interactive `<a>` elements that open in a new browser tab.

## Files to Modify

| File                                                                      | Change                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/web/src/utils/logLinkUtils.ts`                                      | **NEW** — URL detection utility                                |
| `apps/web/src/components/code-tasks/CodeTaskLogViewer.tsx`                | Replace plain text `<pre>` rendering with link-aware rendering |
| `apps/web/src/components/code-tasks/__tests__/CodeTaskLogViewer.test.tsx` | **NEW** — tests for link rendering                             |

## Implementation Details

### 1. URL Detection Utility (`logLinkUtils.ts`)

Create a new utility file with:

- `LOG_URL_RE`: Regex pattern matching HTTP/HTTPS URLs — `/(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g`
- `parseLogLine(text: string): (string | URLSegment)[]`: Splits a log line into plain text segments and URL segments. URL segments include `type: 'url'` and the full `url` string.
- `formatUrlForDisplay(url: string): string`: Truncates URLs longer than 80 chars for display, showing first 40 + `...` + last 30 characters.

### 2. Log Viewer Rendering Changes

In `CodeTaskLogViewer.tsx`, replace the plain `<pre>{line.text}</pre>` rendering with:

- A helper `renderLogContent(text: string)` that maps `parseLogLine(text)` output:
  - Plain strings → `<span key={i}>{segment}</span>`
  - URL segments → `<a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">{displayText}</a>`

Apply this to all three places `<pre>` is used for log content:
1. Main log line (line 370)
2. Collapsed block toggle button text (line 383)
3. Body lines (line 390)

### 3. Test Coverage

Create `CodeTaskLogViewer.test.tsx` with:
- URL detection: line with single URL renders as link
- URL detection: line with multiple URLs renders all as links
- URL detection: line with no URL renders as plain text
- URL display: long URLs are truncated with `formatUrlForDisplay`
- URL attributes: links have `target="_blank"` and `rel="noopener noreferrer"`
- Body lines: links in collapsed/expanded body output render correctly
- Integration: copy button, collapsible blocks, and Claude filter still work with links

## Endpoint Changes

None — this is a pure frontend change.

## Verification

1. `pnpm run verify:workspace:tracked -- web` passes
2. `pnpm run ci:tracked` passes
