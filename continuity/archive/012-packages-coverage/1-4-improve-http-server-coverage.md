# Task 1-4: Improve http-server health.ts coverage

## Tier

1 - Independent deliverable

## Context

packages/http-server/src/health.ts has partial coverage:

- Lines: 59.09%
- Functions: 82.35%
- Uncovered: lines 67-84, 110

Looking at the code:

- Lines 67-84: checkFirestore() actual Firestore check path (skipped in test env)
- Line 110: checkNotionSdk() catch block (unreachable in normal execution)

## Problem Statement

Need to improve coverage for health.ts by testing the non-test-environment paths.

## Scope

- packages/http-server/src/**tests**/health.test.ts (enhance existing)

## Non-Scope

- validation-handler.ts (already 100%)

## Required Approach

### checkFirestore in non-test environment

- Mock environment variables to simulate non-test environment
- Mock getFirestore to return fake with listCollections
- Test successful Firestore health check
- Test Firestore timeout handling
- Test Firestore error handling

### checkNotionSdk catch block (line 110)

Analysis: The catch block in checkNotionSdk is defensive code that can never be reached:

```javascript
export function checkNotionSdk(): HealthCheck {
  const start = Date.now();
  try {
    return { name: 'notion-sdk', status: 'ok', ... };
  } catch {
    return { name: 'notion-sdk', status: 'down', ... };
  }
}
```

The try block contains no throwing code, so the catch is unreachable.

Options:

1. Remove unreachable catch block (breaking change if future code throws)
2. Document as intentional defensive code
3. Add vitest coverage ignore comment

Decision: Add vitest ignore comment for intentionally unreachable defensive code.

## Step Checklist

- [ ] Add tests for checkFirestore non-test environment paths
- [ ] Add tests for Firestore timeout scenario
- [ ] Add tests for Firestore error scenario
- [ ] Add vitest ignore comment for unreachable checkNotionSdk catch
- [ ] Run tests and verify coverage improves

## Definition of Done

health.ts has >90% line coverage

## Verification Commands

```bash
npm run test -- packages/http-server --coverage
```

## Rollback Plan

Revert changes to health.test.ts if task fails
