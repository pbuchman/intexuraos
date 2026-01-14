# Task 2-0: Verify and Polish

**Tier:** 2 (Verification)
**Context:** Final check of the integrated system.

## Problem Statement

Ensure all components work together and coverage is maintained.

## Scope

- Global

## Steps

1. [ ] Check test coverage across affected packages.
   - `packages/llm-common`
   - `apps/actions-agent`
   - `apps/calendar-agent`
   - `apps/web`
2. [ ] If coverage dropped, write tests.
3. [ ] Verify linting passes.
4. [ ] Prepare for archival.

## Verification

```bash
pnpm test
pnpm lint
```
