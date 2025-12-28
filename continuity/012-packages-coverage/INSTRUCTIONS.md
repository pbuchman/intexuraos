# Instructions for Task 012: Packages Test Coverage

## Overview
This task adds comprehensive test coverage to all packages/* modules in the IntexuraOS monorepo.

## Rules

### File Numbering
Issue files use `[tier]-[sequence]-[title].md` pattern:
- `0-0-*.md` - Tier 0: Setup/diagnostics
- `1-0-*.md`, `1-1-*.md`, ... - Tier 1: Independent deliverables
- `2-0-*.md` - Tier 2: Dependent/integrative deliverables

### Idempotent Execution
- Each task can be re-run without side effects
- Tests are additive, not destructive
- Coverage improvements are monotonic (never decrease)

### Ledger Semantics
- CONTINUITY.md is the single source of truth
- Update after every subtask completion
- Never overwrite, only append

### Resume Procedure
1. Read CONTINUITY.md
2. Find "Now" section for current task
3. Continue from that point
4. Update ledger on completion

## Test File Locations
All tests must be in `src/__tests__/` subdirectory of each package:
- `packages/common-core/src/__tests__/*.test.ts`
- `packages/common-http/src/__tests__/*.test.ts`
- `packages/infra-firestore/src/__tests__/*.test.ts`
- `packages/infra-notion/src/__tests__/*.test.ts`
- `packages/http-server/src/__tests__/*.test.ts` (exists)
- `packages/http-contracts/src/__tests__/*.test.ts` (exists)

## Verification Commands

```bash
# Run all tests
npm run test

# Run tests with coverage
npm run test:coverage

# Run CI (includes lint, typecheck, tests, coverage)
npm run ci

# Run tests for specific package
npm run test -- packages/common-core
```

## Success Criteria
- All packages have tests in correct location
- Coverage thresholds pass for all packages
- npm run ci passes
