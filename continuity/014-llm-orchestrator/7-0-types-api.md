# 7-0: Types & API

**Tier:** 7 - Frontend - Orchestrator UI
**Status:** Pending

## Context

Add Research types and llmOrchestratorApi service for frontend.

## Problem Statement

Frontend needs types and API service to interact with llm-orchestrator-service.

## Scope

**In Scope:**
- Add Research, LlmResult types
- Create llmOrchestratorApi service
- All CRUD operations

**Out of Scope:**
- UI components (7-1 to 7-4)

## Required Approach

1. Mirror backend types
2. Use useApiClient pattern
3. Add service URL to config

## Step Checklist

- [ ] Add `INTEXURAOS_LLM_ORCHESTRATOR_SERVICE_URL` to `apps/web/src/config.ts`
- [ ] Add Research types to `apps/web/src/types/index.ts`
- [ ] Create `apps/web/src/services/llmOrchestratorApi.ts`
- [ ] Implement `submitResearch()`
- [ ] Implement `listResearches()`
- [ ] Implement `getResearch(id)`
- [ ] Implement `deleteResearch(id)`

## Definition of Done

- [ ] Types defined
- [ ] API service complete
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/web
```

## Rollback Plan

Delete types and API service file.
