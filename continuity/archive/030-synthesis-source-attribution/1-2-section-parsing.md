# 1-2: Section Parsing

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Parse Markdown sections from synthesis output to identify where Attribution lines should appear.

## Codebase Rules

Read `.claude/CLAUDE.md`:

- Strict TypeScript patterns
- Use `arr[0] ?? fallback` for indexed access

## Dependencies

- **Requires:** 1-0-attribution-types.md completed
- **Requires:** 1-1-attribution-parsing.md completed

## Problem Statement

Implement functions to parse Markdown headings and extract sections with their Attribution lines.

**Section parsing rules:**

1. Prefer `##` headings as section boundaries
2. If no `##` headings exist, fall back to `###` headings
3. If no headings at all, treat entire document as one section titled "Synthesis"
4. Extract the Attribution line at the end of each section (if present)

## Files to Modify

| File                                              | Action                     |
| ------------------------------------------------- | -------------------------- |
| `packages/common-core/src/prompts/attribution.ts` | **MODIFY** (add functions) |

## Files to Read First

1. `packages/common-core/src/prompts/attribution.ts` — types and parseAttributionLine

## Required Implementation

```typescript
/**
 * Parse sections from synthesis markdown output.
 * Sections are bounded by ## headings (preferred) or ### headings (fallback).
 * If no headings found, treats entire document as one section.
 */
export function parseSections(markdown: string): ParsedSection[] {
  // Implementation here
}

/**
 * Helper to detect heading level and extract title.
 * Returns null if line is not a heading.
 */
function parseHeading(line: string): { level: number; title: string } | null {
  // Implementation here
}
```

## Algorithm

1. Split markdown into lines
2. Scan for `##` headings first
3. If none found, scan for `###` headings
4. If still none, create single implicit section
5. For each section:
   - Extract title from heading
   - Find content between this heading and next (or end)
   - Look for `Attribution:` line at end of content
   - Parse attribution if found
6. Return array of ParsedSection objects

## Section Detection Logic

```typescript
// Heading detection regex
const H2_REGEX = /^##\s+(.+)$/;
const H3_REGEX = /^###\s+(.+)$/;

// Attribution line detection (at end of section)
// Look for last non-empty line that starts with "Attribution:"
```

## Edge Cases to Handle

- Empty sections (heading followed immediately by another heading)
- Attribution line with extra trailing whitespace
- Mixed `##` and `###` headings (use `##` as boundaries, ignore `###`)
- Section at end of document (no trailing heading)
- Document with only whitespace lines

## Step Checklist

- [ ] Add `parseHeading` helper function
- [ ] Add `parseSections` function
- [ ] Handle `##` → `###` fallback
- [ ] Handle no-headings fallback
- [ ] Extract Attribution from each section
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Both functions implemented and exported
- All edge cases handled
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Remove the functions from attribution.ts (keep types and parseAttributionLine).

## Non-Negotiable Quality Bar

- Must handle `##` → `###` → implicit section fallback chain
- Must correctly identify Attribution line at section end
- Section boundaries must be accurate (no off-by-one errors)
- No `any` types
