# 5-3: DI Container

**Tier:** 5 - LLM Orchestrator Routes & Server
**Status:** Pending

## Context

Create dependency injection container for the service.

## Problem Statement

Need services.ts with getServices, setServices, resetServices for testability.

## Scope

**In Scope:**
- Create services.ts
- Wire up all dependencies
- Support test injection

**Out of Scope:**
- Implementation details (handled in Tier 4)

## Required Approach

1. Follow existing services.ts patterns
2. Lazy initialization
3. Support setServices for tests

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/services.ts`
- [ ] Define `Services` interface
- [ ] Include: researchRepository, llmAdapters, notificationSender, userKeysClient
- [ ] Implement `getServices()` with lazy init
- [ ] Implement `setServices()` for tests
- [ ] Implement `resetServices()` for cleanup

## Definition of Done

- [ ] All dependencies wired up
- [ ] Test injection works
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete services.ts.
