# Coverage Improvements - Session 017

## Goal

Improve test coverage to meet thresholds:

- Lines: 95% (currently 93.84%)
- Statements: 95% (currently 93.58%)
- Functions: 95% (currently 94.19%)
- Branches: 95% (currently 92.11%)

## Scope

Focus on easy-wins first (Tier 1-2), then larger gaps if time permits.

## Constraints

- **NEVER** modify `vitest.config.ts` exclusions or thresholds
- Write tests to achieve coverage
- Each fix must be verified with coverage run

## Success Criteria

All coverage thresholds pass: `npm run test:coverage` exits 0.
