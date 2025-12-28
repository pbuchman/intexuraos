# Task 0-0: Verify Test File Locations

## Tier
0 - Diagnostics

## Context
Before adding tests, verify existing tests are in correct locations and identify any misplaced tests.

## Problem Statement
Tests should be colocated in `src/__tests__/` subdirectory of each package. Verify this convention is followed.

## Scope
- packages/http-server/src/__tests__/ (verify exists)
- packages/http-contracts/src/__tests__/ (verify exists)
- packages/common-core (create __tests__ directory)
- packages/common-http (create __tests__ directory)
- packages/infra-firestore (create __tests__ directory)
- packages/infra-notion (create __tests__ directory)

## Non-Scope
- Actual test implementation (covered by Tier 1 tasks)

## Required Approach
1. List existing test directories
2. Identify packages missing __tests__ directories
3. Create missing directories

## Step Checklist
- [ ] Verify packages/http-server/src/__tests__/ exists
- [ ] Verify packages/http-contracts/src/__tests__/ exists
- [ ] Create packages/common-core/src/__tests__/
- [ ] Create packages/common-http/src/__tests__/
- [ ] Create packages/infra-firestore/src/__tests__/
- [ ] Create packages/infra-notion/src/__tests__/

## Definition of Done
All packages have src/__tests__/ directory

## Verification Commands
```bash
find packages -type d -name "__tests__" | sort
```

## Rollback Plan
Remove newly created directories if task fails
