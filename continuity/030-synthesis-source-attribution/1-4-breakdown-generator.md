# 1-4: Breakdown Generator

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Generate the "Source Utilization Breakdown" markdown appendix from parsed sections and source map.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- No obvious comments
- Keep functions focused (SRP)

## Dependencies

- **Requires:** 1-0-attribution-types.md completed
- **Requires:** 1-1-attribution-parsing.md completed
- **Requires:** 1-2-section-parsing.md completed
- **Requires:** 1-3-validation.md completed

## Problem Statement

Generate a deterministic markdown appendix showing:
1. Scorecard table (per-source counts and scores)
2. Per-source usage (which sections used each source)
3. Ignored sources (sources with zero usage)

**Score formula:** `primaryCount * 3 + secondaryCount * 1` (constraints excluded from score)

## Files to Modify

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/attribution.ts` | **MODIFY** (add function) |

## Files to Read First

1. `packages/common-core/src/prompts/attribution.ts` — types and parsing functions

## Required Implementation

```typescript
/**
 * Generate the Source Utilization Breakdown markdown appendix.
 * This is appended to the synthesis output by code, NOT by the LLM.
 */
export function generateBreakdown(
  sections: ReadonlyArray<ParsedSection>,
  sourceMap: ReadonlyArray<SourceMapItem>
): string {
  // Implementation here
}
```

## Output Format

```markdown
## Source Utilization Breakdown (Generated)

### Scorecard

| ID | Name | Primary | Secondary | Constraints | Score |
|----|------|---------|-----------|-------------|-------|
| S1 | GPT-4 | 4 | 1 | 0 | 13 |
| S2 | Claude | 2 | 3 | 1 | 9 |
| U1 | Wikipedia | 0 | 2 | 1 | 2 |

### Per-Source Usage

- **S1** (GPT-4): Primary in: Overview, Details. Secondary in: Pricing. Constraints in: —
- **S2** (Claude): Primary in: Details. Secondary in: Overview, Pricing. Constraints in: Caveats
- **U1** (Wikipedia): Primary in: —. Secondary in: History, Context. Constraints in: History

### Ignored Sources

None.

_Attribution data derived from parsed markers. No interpretation applied._
```

## Algorithm

1. Initialize counters for each source in sourceMap
2. For each section with valid attribution:
   - Increment primaryCount for each primary ID
   - Increment secondaryCount for each secondary ID
   - Increment constraintsCount for each constraint ID
   - Track section titles per category
3. Calculate score: `primaryCount * 3 + secondaryCount * 1`
4. Sort by score descending
5. Identify ignored sources (all counts = 0)
6. Generate markdown tables and lists

## Edge Cases

- Section with UNK=true: still count other attributions
- Section with no valid attribution: skip (don't crash)
- All sources ignored: output "All sources were ignored."
- Empty sections array: output "No sections found."

## Step Checklist

- [ ] Add `generateBreakdown` function
- [ ] Implement counting logic
- [ ] Implement score calculation
- [ ] Generate scorecard table
- [ ] Generate per-source usage list
- [ ] Generate ignored sources section
- [ ] Add footer disclaimer
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Function generates complete breakdown markdown
- Output matches format specification
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Remove the function from attribution.ts (keep previous work).

## Non-Negotiable Quality Bar

- Constraints MUST NOT contribute to score
- Output must be deterministic (same input → same output)
- Ignored sources must be explicitly listed
- Must handle edge cases gracefully (no crashes)
