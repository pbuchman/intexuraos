# 5-1: Research Routes

**Tier:** 5 - LLM Orchestrator Routes & Server
**Status:** Pending

## Context

Implement HTTP route handlers for research operations.

## Problem Statement

Need REST endpoints for creating, listing, getting, and deleting researches.

## Scope

**In Scope:**
- POST /research - Submit new research
- GET /research - List user's researches
- GET /research/:id - Get research detail
- DELETE /research/:id - Delete research

**Out of Scope:**
- Server setup (5-2)
- Background processing (5-4)

## Required Approach

1. Follow existing route patterns
2. Use requireAuth middleware
3. Return standard response envelope
4. Queue background processing for POST

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/routes/researchRoutes.ts`
- [ ] Implement POST /research handler
- [ ] Validate input, create research, return ID
- [ ] Implement GET /research handler
- [ ] Paginated list with cursor
- [ ] Implement GET /research/:id handler
- [ ] Authorization check
- [ ] Implement DELETE /research/:id handler
- [ ] Register routes with Fastify

## Definition of Done

- [ ] All endpoints work correctly
- [ ] Authorization enforced
- [ ] Tests pass
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/llm-orchestrator-service
npm run ci
```

## Rollback Plan

Delete routes file.
