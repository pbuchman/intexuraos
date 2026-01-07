# 1-3: Attribution Validation

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Validate that synthesis output has proper Attribution lines for all sections.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- Return Result types for operations that can fail (but here ValidationResult is fine)
- Strict TypeScript patterns

## Dependencies

- **Requires:** 1-0-attribution-types.md completed
- **Requires:** 1-1-attribution-parsing.md completed
- **Requires:** 1-2-section-parsing.md completed

## Problem Statement

Validate that:
1. Every section has an Attribution line
2. All Attribution lines are well-formed
3. All referenced source IDs exist in the source map

## Files to Modify

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/attribution.ts` | **MODIFY** (add functions) |

## Files to Read First

1. `packages/common-core/src/prompts/attribution.ts` — types and parsing functions

## Required Implementation

```typescript
/**
 * Build a source map from reports and additional sources.
 * Maps to neutral IDs: S1..Sn for reports, U1..Um for additional sources.
 */
export function buildSourceMap(
  reports: ReadonlyArray<{ model: string }>,
  additionalSources?: ReadonlyArray<{ label?: string }>
): SourceMapItem[] {
  // Implementation here
}

/**
 * Validate attributions in synthesis output.
 * Returns validation result with list of errors if invalid.
 */
export function validateSynthesisAttributions(
  markdown: string,
  sourceMap: ReadonlyArray<SourceMapItem>
): ValidationResult {
  // Implementation here
}
```

## Validation Rules

1. **Missing Attribution:** Section has no Attribution line → error
2. **Malformed Attribution:** parseAttributionLine returns null → error
3. **Unknown ID:** Any ID in Primary/Secondary/Constraints not in sourceMap → error
4. **UNK=true:** Valid, but flag for monitoring (not an error)

## Error Messages Format

```typescript
// Examples of error messages:
'Section "Overview" is missing Attribution line'
'Section "Details" has malformed Attribution line'
'Section "Pricing" references unknown source ID: S99'
```

## buildSourceMap Logic

```typescript
// Example:
// reports = [{ model: 'GPT-4' }, { model: 'Claude' }]
// additionalSources = [{ label: 'Wikipedia' }]
// Result:
// [
//   { id: 'S1', kind: 'llm', displayName: 'GPT-4' },
//   { id: 'S2', kind: 'llm', displayName: 'Claude' },
//   { id: 'U1', kind: 'user', displayName: 'Wikipedia' },
// ]
```

## Step Checklist

- [ ] Add `buildSourceMap` function
- [ ] Add `validateSynthesisAttributions` function
- [ ] Implement all validation rules
- [ ] Format error messages clearly
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Both functions implemented and exported
- All validation rules enforced
- Clear error messages
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Remove the functions from attribution.ts (keep previous work).

## Non-Negotiable Quality Bar

- Must validate ALL sections, not just first
- Must catch unknown IDs (prevents hallucinated attributions)
- Error messages must identify which section has the problem
- No `any` types
