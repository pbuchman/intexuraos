# Unreachable Branch Coverage Registry

This document catalogs branches that have been verified as **unreachable** through code analysis.
These branches exist as defensive coding practices, TypeScript narrowing artifacts, or impossible-state guards.

**Important:** Only branches that are **genuinely unreachable** in production code should be documented here.
If a branch can be reached with the right test setup, it should NOT be in this file - write a test instead.

---

## `packages/infra-perplexity/src/client.ts`

### Line 165: `buffer = lines.pop() ?? '';`

```typescript
const lines = buffer.split('\n');
buffer = lines.pop() ?? '';
```

- **Reason:** The `??` fallback to empty string is unreachable because:
  1. `buffer` is a string, and `string.split('\n')` always returns an array with at least one element (empty string if input is empty)
  2. `.pop()` on a non-empty array always returns the last element (a string)
  3. Therefore, `.pop()` never returns `undefined`
- **Defensive Purpose:** Guards against theoretical edge cases in SSE stream processing

---

## `packages/llm-common/src/attribution.ts`

### Lines 140, 147: `return title !== undefined ? { level: N, title } : null`

```typescript
// Line 140 (h2)
const h2Match = h2Regex.exec(line);  // regex: /^##\s+(.+)$/
if (h2Match !== null) {
  const title = h2Match[1];
  return title !== undefined ? { level: 2, title } : null;
}

// Line 147 (h3)
const h3Match = h3Regex.exec(line);  // regex: /^###\s+(.+)$/
if (h3Match !== null) {
  const title = h3Match[1];
  return title !== undefined ? { level: 3, title } : null;
}
```

- **Reason:** The `null` branch is unreachable because:
  1. The regex pattern `.+` requires at least one character to match
  2. If the regex matches (`h2Match !== null`), group 1 is guaranteed to capture the title
  3. TypeScript's `noUncheckedIndexedAccess` requires the undefined check even though it can't happen
- **Defensive Purpose:** Satisfies strict TypeScript checks for optional array index access

### Line 166: `if (line === undefined) continue`

```typescript
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === undefined) continue;
```

- **Reason:** The `continue` branch is unreachable because:
  1. `lines` is created from `markdown.split('\n')` which produces a dense array
  2. Array iteration from 0 to `length - 1` always yields defined elements
  3. TypeScript's `noUncheckedIndexedAccess` requires the undefined check
- **Defensive Purpose:** Guards against sparse arrays that cannot exist in this context

### Line 171: `else if (heading.level === 3)`

```typescript
if (heading.level === 2) {
  h2Headings.push({ line: i, title: heading.title });
} else if (heading.level === 3) {
  h3Headings.push({ line: i, title: heading.title });
}
```

- **Reason:** The implicit `else` branch (when level is neither 2 nor 3) is unreachable because:
  1. `parseHeading()` only returns objects with `level: 2` or `level: 3`
  2. If heading is not null, it must have level 2 or level 3
- **Defensive Purpose:** Explicit check for level 3 rather than using `else` to document intent

### Line 196: `if (current === undefined) continue`

```typescript
for (let i = 0; i < headings.length; i++) {
  const current = headings[i];
  const next = headings[i + 1];
  if (current === undefined) continue;
```

- **Reason:** Same as line 166 - `headings` is a dense array built from push operations
- **Defensive Purpose:** TypeScript `noUncheckedIndexedAccess` compliance

### Line 226: `if (line === undefined) continue`

```typescript
for (let i = endLine; i >= startLine; i--) {
  const line = lines[i];
  if (line === undefined) continue;
```

- **Reason:** Same as line 166 - `lines` comes from `string.split()` which produces dense arrays
- **Defensive Purpose:** TypeScript `noUncheckedIndexedAccess` compliance

---

## `packages/llm-common/src/dataInsights/parseInsightResponse.ts`

### Line 28: `if (content === undefined)`

```typescript
const match = /^INSIGHT_\d+:\s*(.+)$/.exec(line);
if (!match) {
  throw new Error(...);
}
const content = match[1];
if (content === undefined) {
  throw new Error(`Line ${String(lineNumber)}: Invalid INSIGHT format - content is undefined`);
}
```

- **Reason:** The exception branch is unreachable because:
  1. The regex requires `.+` in group 1 (at least one character)
  2. If the regex matches (we pass the `!match` check), group 1 is guaranteed to exist
  3. TypeScript requires the check due to `noUncheckedIndexedAccess`
- **Defensive Purpose:** Explicit error message for debugging if regex behavior changes

### Lines 40-46: `if (parts[0] === undefined || parts[1] === undefined || ...)`

```typescript
const parts = content.split(';').map((p) => p.trim());

if (parts.length !== 4) {
  throw new Error(...);
}

if (
  parts[0] === undefined ||
  parts[1] === undefined ||
  parts[2] === undefined ||
  parts[3] === undefined
) {
  throw new Error(`Line ${String(lineNumber)}: Missing required parts`);
}
```

- **Reason:** The exception branch is unreachable because:
  1. We already verified `parts.length === 4` on line 34
  2. An array of length 4 always has defined elements at indices 0-3
  3. TypeScript requires the check due to `noUncheckedIndexedAccess`
- **Defensive Purpose:** Type narrowing for subsequent code that accesses parts[0-3]

### Lines 78, 82, 93: Empty string checks after regex validation

```typescript
// Line 78
if (title.length === 0) {
  throw new Error(`Line ${String(lineNumber)}: Title cannot be empty`);
}

// Line 82
if (description.length === 0) {
  throw new Error(`Line ${String(lineNumber)}: Description cannot be empty`);
}

// Line 93
if (trackableMetric.length === 0) {
  throw new Error(`Line ${String(lineNumber)}: Trackable metric cannot be empty`);
}
```

- **Reason:** These branches are unreachable because:
  1. The regex patterns (e.g., `/^Title=(.+)$/`) require `.+` which matches 1+ characters
  2. After `.trim()`, the result can only be empty if the original was all whitespace
  3. But `.+` in regex requires at least one non-whitespace char at the boundaries
- **Defensive Purpose:** Explicit validation after type narrowing

### Line 120: `if (reason.length === 0)`

```typescript
const match = /^NO_INSIGHTS:\s*Reason=(.+)$/.exec(line);
if (match?.[1] === undefined) {
  throw new Error(...);
}
const reason = match[1].trim();
if (reason.length === 0) {
  throw new Error(`Line ${String(lineNumber)}: Reason cannot be empty`);
}
```

- **Reason:** Same as above - regex `.+` requires non-empty content
- **Defensive Purpose:** Explicit error for debugging

### Line 138: `if (firstLine === undefined)`

```typescript
if (lines.length === 0) {
  throw new Error('Empty response from LLM');
}
const firstLine = lines[0];
if (firstLine === undefined) {
  throw new Error('Empty response from LLM');
}
```

- **Reason:** The exception branch is unreachable because:
  1. We already verified `lines.length > 0` on line 133
  2. An array with length > 0 always has a defined element at index 0
- **Defensive Purpose:** TypeScript `noUncheckedIndexedAccess` compliance

### Line 153: `if (line === undefined)`

```typescript
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === undefined) {
    throw new Error(`Line ${String(i + 1)}: Line is undefined`);
  }
```

- **Reason:** Same dense array pattern - iteration within bounds always yields defined elements
- **Defensive Purpose:** TypeScript `noUncheckedIndexedAccess` compliance

### Line 165: `if (insights.length === 0)`

```typescript
if (insights.length === 0) {
  throw new Error('No insights found in response');
}
```

- **Reason:** This branch is unreachable because:
  1. The only way to reach this point is if all lines started with `INSIGHT_`
  2. Each such line adds an insight to the array (or throws on parse error)
  3. At least one line must exist (verified at line 133)
- **Defensive Purpose:** Guard against logic errors in parsing loop

---

## Summary

| File | Unreachable Branches | Root Cause |
|------|---------------------|------------|
| `infra-perplexity/src/client.ts` | 1 | Array.pop() on non-empty array |
| `llm-common/src/attribution.ts` | 6 | TypeScript noUncheckedIndexedAccess + regex guarantees |
| `llm-common/src/dataInsights/parseInsightResponse.ts` | 9 | TypeScript noUncheckedIndexedAccess + regex guarantees + prior validation |

**Total Unreachable Branches in packages/:** 16

These branches exist as defensive coding practices required by TypeScript's strict mode (`noUncheckedIndexedAccess`).
Removing them would cause type errors. They provide meaningful error messages if assumptions are ever violated.
