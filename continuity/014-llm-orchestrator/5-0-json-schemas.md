# 5-0: JSON Schemas

**Tier:** 5 - LLM Orchestrator Routes & Server
**Status:** Pending

## Context

Define JSON schemas for route validation.

## Problem Statement

Fastify routes need JSON schemas for request/response validation.

## Scope

**In Scope:**
- Request schemas for POST /research
- Response schemas for all endpoints
- Error response schemas

**Out of Scope:**
- Route handlers (5-1)

## Required Approach

1. Follow existing schema patterns
2. Use Fastify JSON Schema format
3. Define reusable schema components

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/routes/schemas.ts`
- [ ] Define `ResearchSchema` response
- [ ] Define `ResearchListSchema` response
- [ ] Define `CreateResearchSchema` request body
- [ ] Define error schemas
- [ ] Export all schemas

## Definition of Done

- [ ] All schemas defined
- [ ] Schemas validate correctly
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete schemas file.
