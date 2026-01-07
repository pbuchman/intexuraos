# TASK-16: Enable Verification Rules in CI

## Status: PENDING

## Depends On: TASK-01 through TASK-15 (all migrations complete)

## Objective

Ensure RULE-4 and RULE-5 are enforced in CI pipeline. Currently the verification script is already in CI but these rules will only pass after all migrations are complete.

## Pre-Requisites

Before enabling, verify all violations are fixed:

```bash
npx tsx scripts/verify-llm-architecture.ts
```

Expected output:
```
=== LLM Architecture Verification ===

Rule 1: Checking for unauthorized LLMClient implementations...
Rule 2: Checking if clients log usage...
Rule 3: Checking for hardcoded cost values in apps/...
Rule 4: Checking for hardcoded model strings...
Rule 5: Checking for hardcoded provider strings...
All checks passed! No violations found.
```

## Verification

```bash
npm run ci
```

## Acceptance Criteria

- [ ] `npm run verify:llm-architecture` passes (0 violations)
- [ ] `npm run ci` passes completely
- [ ] All tests pass
- [ ] Typecheck passes

