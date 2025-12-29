# 3-0: Domain Models

**Tier:** 3 - LLM Orchestrator Domain
**Status:** Pending

## Context

Define domain models for the llm-orchestrator-service.

## Problem Statement

Need Research and LlmResult models to represent research requests and results.

## Scope

**In Scope:**
- Create `Research` model
- Create `LlmResult` model
- Create `LlmProvider` type
- Create error types

**Out of Scope:**
- Ports (3-1)
- Usecases (3-3)

## Required Approach

1. Follow existing domain model patterns
2. Use string ISO dates for timestamps
3. Keep models simple and focused

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/domain/research/models/Research.ts`
- [ ] Define `Research` interface with all fields
- [ ] Define `LlmResult` interface
- [ ] Define `LlmProvider` type ('google' | 'openai' | 'anthropic')
- [ ] Define `ResearchStatus` type
- [ ] Create `ResearchError` type
- [ ] Export from domain index

## Definition of Done

- [ ] All models defined with proper types
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete model files.
