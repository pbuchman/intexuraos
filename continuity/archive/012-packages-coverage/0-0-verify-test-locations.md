# Task 0-0: Verify Test File Locations

## Tier

0 - Diagnostics

## Context

Before adding tests, verify existing tests are in correct locations and identify any misplaced tests.

## Problem Statement

Tests should be colocated in `src/__tests__/` subdirectory of each package. Verify this convention is followed.

## Scope

- packages/http-server/src/**tests**/ (verify exists)
- packages/http-contracts/src/**tests**/ (verify exists)
- packages/common-core (create **tests** directory)
- packages/common-http (create **tests** directory)
- packages/infra-firestore (create **tests** directory)
- packages/infra-notion (create **tests** directory)

## Non-Scope

- Actual test implementation (covered by Tier 1 tasks)

## Required Approach

1. List existing test directories
2. Identify packages missing **tests** directories
3. Create missing directories

## Step Checklist

- [ ] Verify packages/http-server/src/**tests**/ exists
- [ ] Verify packages/http-contracts/src/**tests**/ exists
- [ ] Create packages/common-core/src/**tests**/
- [ ] Create packages/common-http/src/**tests**/
- [ ] Create packages/infra-firestore/src/**tests**/
- [ ] Create packages/infra-notion/src/**tests**/

## Definition of Done

All packages have src/**tests**/ directory

## Verification Commands

```bash
find packages -type d -name "__tests__" | sort
```

## Rollback Plan

Remove newly created directories if task fails
