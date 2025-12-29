# 3-3: Usecases

**Tier:** 3 - LLM Orchestrator Domain
**Status:** Pending

## Context

Implement domain usecases for research operations.

## Problem Statement

Need usecases for submitting, retrieving, processing, and managing research.

## Scope

**In Scope:**
- `submitResearch` - Create new research request
- `getResearch` - Get research by ID or list by user
- `processResearch` - Execute LLM calls and synthesis
- `generateTitle` - Generate title from prompt

**Out of Scope:**
- Infrastructure implementations (Tier 4)
- HTTP routes (Tier 5)

## Required Approach

1. Follow existing usecase patterns
2. Use Result<T, E> for error handling
3. Keep usecases focused on single responsibility

## Step Checklist

- [ ] Create `submitResearch.ts` usecase
- [ ] Validate input, create Research record, return ID
- [ ] Create `getResearch.ts` usecase
- [ ] Get by ID with user authorization check
- [ ] Create `listResearches.ts` usecase
- [ ] Paginated list with cursor
- [ ] Create `deleteResearch.ts` usecase
- [ ] Create `processResearch.ts` usecase
- [ ] Execute LLM calls in parallel
- [ ] Synthesize results
- [ ] Update status
- [ ] Create `generateTitle.ts` usecase
- [ ] Use Gemini to generate title from prompt
- [ ] Add unit tests for all usecases

## Definition of Done

- [ ] All usecases implemented
- [ ] Tests pass
- [ ] `npm run ci` passes

## Verification Commands

```bash
npm run test --workspace=@intexuraos/llm-orchestrator-service
npm run ci
```

## Rollback Plan

Delete usecase files.
