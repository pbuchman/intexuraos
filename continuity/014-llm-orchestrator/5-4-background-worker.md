# 5-4: Background Worker

**Tier:** 5 - LLM Orchestrator Routes & Server
**Status:** Pending

## Context

Implement background worker for async research processing.

## Problem Statement

Research processing takes 1-5 minutes. Need async processing with status updates.

## Scope

**In Scope:**
- Create background worker
- Poll for pending researches
- Process each research
- Update status on completion
- Send notification

**Out of Scope:**
- Pub/Sub integration (keep it simple with polling)
- Horizontal scaling

## Required Approach

1. Simple polling-based worker
2. Process one research at a time
3. Update status after each step
4. Handle errors gracefully

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/workers/researchWorker.ts`
- [ ] Implement polling loop
- [ ] Query for pending researches
- [ ] Call processResearch usecase
- [ ] Handle errors and update status
- [ ] Update `src/index.ts` to start worker alongside server

## Definition of Done

- [ ] Worker processes pending researches
- [ ] Status updates work correctly
- [ ] Errors don't crash worker
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete worker file and revert index.ts.
