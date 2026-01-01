# Coverage Improvements - Session 020

## Goal

Improve test coverage to 100% across all packages and apps by addressing uncovered lines, branches, and functions.

## Scope

All files with < 100% coverage as identified in the coverage report.

## Success Criteria

- All packages maintain 95%+ coverage thresholds
- All identified gaps addressed or documented as blocked
- `npm run ci` passes

## Constraints

- **NEVER** modify `vitest.config.ts` exclusions or thresholds
- Write tests to achieve coverage
- Document any unreachable code as blockers
