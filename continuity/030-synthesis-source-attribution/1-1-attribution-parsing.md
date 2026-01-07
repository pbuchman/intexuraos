# 1-1: Attribution Line Parsing

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Parse the `Attribution:` line format that the LLM will output at the end of each section.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- Strict TypeScript patterns
- No obvious comments

## Dependencies

- **Requires:** 1-0-attribution-types.md completed

## Problem Statement

Implement a function to parse Attribution lines from synthesis output.

**Input format:**
```
Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false
```

**Parsing requirements:**
- Multi-digit IDs supported: `S10`, `U12` (use `\d+` not `\d`)
- Whitespace tolerant: `Primary = S1 , S2` is valid
- Empty lists allowed: `Constraints=;`
- `UNK` must be `true` or `false`
- Return `null` for malformed lines

## Files to Modify

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/attribution.ts` | **MODIFY** (add function) |

## Files to Read First

1. `packages/common-core/src/prompts/attribution.ts` — your types from 1-0

## Required Implementation

```typescript
/**
 * Parse an Attribution line from synthesis output.
 * Returns null if the line is malformed or doesn't match expected format.
 *
 * @example
 * parseAttributionLine('Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false')
 * // Returns: { primary: ['S1', 'S2'], secondary: ['U1'], constraints: [], unk: false }
 */
export function parseAttributionLine(line: string): AttributionLine | null {
  // Implementation here
}
```

## Parsing Algorithm

1. Check line starts with `Attribution:` (case-insensitive after trim)
2. Extract part after `Attribution:`
3. Split by `;` to get key-value pairs
4. For each pair, split by `=` to get key and value
5. Parse `Primary`, `Secondary`, `Constraints` as comma-separated ID lists
6. Parse `UNK` as boolean (`true`/`false` only)
7. Validate all IDs match pattern `S\d+` or `U\d+`
8. Return null if any required key is missing or malformed

## Edge Cases to Handle

- Extra whitespace: `Primary = S1 , S2`
- Empty values: `Constraints=`
- Multi-digit: `S10`, `U123`
- Mixed case: `primary=S1` (should normalize)
- Missing UNK key → treat as `false`
- Invalid ID format → return null

## Step Checklist

- [ ] Add `parseAttributionLine` function to attribution.ts
- [ ] Handle all edge cases above
- [ ] Add JSDoc with @example
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- Function implemented and exported
- Handles all edge cases
- `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
```

## Rollback Plan

Remove the function from attribution.ts (keep types from 1-0).

## Non-Negotiable Quality Bar

- Must support multi-digit IDs (`\d+` not `\d`)
- Must return `null` for invalid input (no throwing)
- No `any` types
- Must have JSDoc with @example
