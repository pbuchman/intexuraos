# 4-0: Firestore Repository

**Tier:** 4 - LLM Orchestrator Infrastructure
**Status:** Pending

## Context

Implement Firestore repository for Research entities.

## Problem Statement

Need persistent storage for research requests and results.

## Scope

**In Scope:**
- Implement `ResearchRepository` port
- CRUD operations on `researches` collection
- Cursor-based pagination

**Out of Scope:**
- User settings access (4-2)

## Required Approach

1. Follow existing Firestore repository patterns
2. Use `@intexuraos/infra-firestore` package
3. Store by userId for multi-tenant isolation

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/infra/firestore/researchRepository.ts`
- [ ] Implement `create()` method
- [ ] Implement `getById()` method
- [ ] Implement `list()` method with pagination
- [ ] Implement `update()` method
- [ ] Implement `delete()` method
- [ ] Add integration tests with fake repository

## Definition of Done

- [ ] All CRUD operations work
- [ ] Pagination works correctly
- [ ] Tests pass
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/llm-orchestrator-service
npm run ci
```

## Rollback Plan

Delete repository file.
