# 1-0: Attribution Types

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Before implementing attribution logic, define all TypeScript types in a new module.

## Codebase Rules

Read `.claude/CLAUDE.md` before starting:
- Strict TypeScript mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Use `arr[0] ?? fallback` pattern for indexed access
- No domain logic in this task—types only

## Problem Statement

Create type definitions for the attribution system. These types will be used by parsing, validation, and breakdown generation functions.

## Files to Create

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/attribution.ts` | **CREATE** |

## Files to Read First

1. `packages/common-core/src/prompts/synthesisPrompt.ts` — understand `SynthesisReport` and `AdditionalSource` types
2. `packages/common-core/src/prompts/index.ts` — see existing export patterns

## Required Types

```typescript
/**
 * Source identifier format: S1, S2, ... for LLM reports; U1, U2, ... for user sources
 */
export type SourceId = `S${number}` | `U${number}`;

/**
 * Entry in the source map built from reports and additionalSources
 */
export interface SourceMapItem {
  id: SourceId;
  kind: 'llm' | 'user';
  displayName: string;
}

/**
 * Parsed Attribution line from synthesis output
 * Example: Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false
 */
export interface AttributionLine {
  primary: SourceId[];
  secondary: SourceId[];
  constraints: SourceId[];
  unk: boolean;
}

/**
 * A parsed section from the synthesis markdown
 */
export interface ParsedSection {
  title: string;
  level: number; // 2 for ##, 3 for ###
  attribution: AttributionLine | null;
  startLine: number;
  endLine: number;
}

/**
 * Result of validating attributions in synthesis output
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Entry in the generated breakdown scorecard
 */
export interface BreakdownEntry {
  id: SourceId;
  name: string;
  primaryCount: number;
  secondaryCount: number;
  constraintsCount: number;
  score: number; // primaryCount * 3 + secondaryCount * 1 (constraints excluded)
  usedFor: {
    primary: string[];   // section titles
    secondary: string[];
    constraints: string[];
  };
}
```

## Step Checklist

- [ ] Create `packages/common-core/src/prompts/attribution.ts`
- [ ] Add all type definitions above
- [ ] Add JSDoc comments for each type
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`

## Definition of Done

- File created with all types
- `npm run typecheck` passes
- `npm run lint` passes

## Verification Commands

```bash
npm run typecheck
npm run lint
cat packages/common-core/src/prompts/attribution.ts
```

## Rollback Plan

```bash
rm packages/common-core/src/prompts/attribution.ts
```

## Non-Negotiable Quality Bar

- All types must have JSDoc comments
- Use template literal type for `SourceId` (not `string`)
- No `any` types
