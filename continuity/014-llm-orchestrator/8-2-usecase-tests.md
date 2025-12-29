# 8-2: Usecase Tests

**Tier:** 8 - Integration & Testing
**Status:** Pending

## Context

Create unit tests for domain usecases.

## Problem Statement

Usecases need test coverage with mocked ports.

## Scope

**In Scope:**
- Tests for all usecases
- Mock ports
- Test error cases

**Out of Scope:**
- Integration tests (8-1)

## Required Approach

1. Follow existing usecase test patterns
2. Mock all ports
3. Test success and error paths

## Step Checklist

- [ ] Create test files for each usecase
- [ ] `submitResearch.test.ts`
- [ ] `getResearch.test.ts`
- [ ] `listResearches.test.ts`
- [ ] `deleteResearch.test.ts`
- [ ] `processResearch.test.ts`
- [ ] `generateTitle.test.ts`
- [ ] Test authorization checks
- [ ] Test error handling

## Definition of Done

- [ ] All usecases tested
- [ ] Coverage thresholds met
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/llm-orchestrator-service
npm run test:coverage --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete test files.
