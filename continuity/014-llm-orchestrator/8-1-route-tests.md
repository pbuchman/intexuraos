# 8-1: Route Tests

**Tier:** 8 - Integration & Testing
**Status:** Pending

## Context

Create integration tests for llm-orchestrator-service routes.

## Problem Statement

Routes need test coverage using app.inject() pattern.

## Scope

**In Scope:**
- Tests for all research routes
- Mock repositories and dependencies
- Test authorization

**Out of Scope:**
- End-to-end tests
- Performance tests

## Required Approach

1. Follow existing test patterns
2. Use fake repositories
3. Use setServices() for injection

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/__tests__/researchRoutes.test.ts`
- [ ] Create fake ResearchRepository
- [ ] Test POST /research - success
- [ ] Test POST /research - validation error
- [ ] Test GET /research - list with pagination
- [ ] Test GET /research/:id - success
- [ ] Test GET /research/:id - not found
- [ ] Test GET /research/:id - forbidden (wrong user)
- [ ] Test DELETE /research/:id - success
- [ ] Test DELETE /research/:id - not found

## Definition of Done

- [ ] All routes tested
- [ ] Coverage thresholds met
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/llm-orchestrator-service
npm run test:coverage --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete test files.
