# 1-5: Attribution Module Tests

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Write comprehensive unit tests for the attribution module to achieve 95% coverage.

## Codebase Rules

Read `.claude/CLAUDE.md`:
- 95% coverage required (NEVER modify thresholds)
- Use Vitest with explicit imports (`describe`, `it`, `expect`)
- Factory functions for test data
- Use `.toContain()` for string validation, `.toBe()` for type checks

## Dependencies

- **Requires:** 1-0 through 1-4 completed

## Problem Statement

Create test file with comprehensive coverage of all attribution module functions.

## Files to Create

| File | Action |
|------|--------|
| `packages/common-core/src/prompts/__tests__/attribution.test.ts` | **CREATE** |

## Files to Read First

1. `packages/common-core/src/prompts/attribution.ts` — the module to test
2. `packages/common-core/src/prompts/__tests__/synthesisPrompt.test.ts` — testing patterns

## Test Categories

### parseAttributionLine Tests

```typescript
describe('parseAttributionLine', () => {
  it('parses valid attribution line', () => {
    const result = parseAttributionLine(
      'Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false'
    );
    expect(result).toEqual({
      primary: ['S1', 'S2'],
      secondary: ['U1'],
      constraints: [],
      unk: false,
    });
  });

  it('handles multi-digit IDs', () => {
    // S10, U12
  });

  it('handles whitespace variations', () => {
    // Primary = S1 , S2
  });

  it('returns null for malformed line', () => {
    // Missing keys, invalid format
  });

  it('returns null for unknown ID format', () => {
    // X1, invalid
  });

  it('handles empty constraints list', () => {
    // Constraints=;
  });

  it('parses UNK=true', () => {
    // UNK=true
  });
});
```

### parseSections Tests

```typescript
describe('parseSections', () => {
  it('parses ## headings as sections', () => {});
  it('falls back to ### when no ## present', () => {});
  it('creates implicit section when no headings', () => {});
  it('extracts attribution from section end', () => {});
  it('handles empty sections', () => {});
  it('handles section at document end', () => {});
});
```

### buildSourceMap Tests

```typescript
describe('buildSourceMap', () => {
  it('maps reports to S1..Sn', () => {});
  it('maps additionalSources to U1..Um', () => {});
  it('handles empty arrays', () => {});
  it('uses Source N fallback for missing label', () => {});
});
```

### validateSynthesisAttributions Tests

```typescript
describe('validateSynthesisAttributions', () => {
  it('returns valid for correct attributions', () => {});
  it('returns error for missing attribution', () => {});
  it('returns error for malformed attribution', () => {});
  it('returns error for unknown source ID', () => {});
  it('accepts UNK=true as valid', () => {});
});
```

### generateBreakdown Tests

```typescript
describe('generateBreakdown', () => {
  it('generates scorecard table', () => {});
  it('calculates score correctly (constraints excluded)', () => {});
  it('generates per-source usage list', () => {});
  it('identifies ignored sources', () => {});
  it('handles empty sections array', () => {});
  it('sorts by score descending', () => {});
});
```

## Step Checklist

- [ ] Create test file
- [ ] Add parseAttributionLine tests (all edge cases)
- [ ] Add parseSections tests (all fallbacks)
- [ ] Add buildSourceMap tests
- [ ] Add validateSynthesisAttributions tests
- [ ] Add generateBreakdown tests
- [ ] Export attribution module from `packages/common-core/src/prompts/index.ts`
- [ ] Export from `packages/common-core/src/index.ts` if needed
- [ ] Run `npm run test -- packages/common-core`
- [ ] Verify coverage meets 95%

## Export Step

Add to `packages/common-core/src/prompts/index.ts`:

```typescript
export * from './attribution.js';
```

This exports all types and functions from the attribution module.

## Definition of Done

- All test categories implemented
- `npm run test` passes
- Coverage ≥95% for attribution.ts

## Verification Commands

```bash
npm run test -- packages/common-core/src/prompts/__tests__/attribution.test.ts
npm run test -- packages/common-core --coverage
```

## Rollback Plan

```bash
rm packages/common-core/src/prompts/__tests__/attribution.test.ts
```

## Non-Negotiable Quality Bar

- 95% coverage on attribution.ts (MANDATORY)
- Test multi-digit IDs explicitly
- Test all fallback paths in parseSections
- Test score calculation excludes constraints
- Use factory functions for complex test data
