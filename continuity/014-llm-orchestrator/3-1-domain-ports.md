# 3-1: Domain Ports

**Tier:** 3 - LLM Orchestrator Domain
**Status:** Pending

## Context

Define port interfaces for the llm-orchestrator-service domain layer.

## Problem Statement

Need interfaces for ResearchRepository, LlmProvider, NotificationSender.

## Scope

**In Scope:**
- Create `ResearchRepository` port
- Create `LlmProviderAdapter` port
- Create `NotificationSender` port

**Out of Scope:**
- Implementations (Tier 4)

## Required Approach

1. Follow existing port patterns (user-service, whatsapp-service)
2. Use Result<T, E> for error handling
3. Keep interfaces minimal

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/domain/research/ports/ResearchRepository.ts`
- [ ] Define CRUD methods: create, getById, list, update, delete
- [ ] Create `apps/llm-orchestrator-service/src/domain/research/ports/LlmProviderAdapter.ts`
- [ ] Define `research(prompt: string, apiKey: string)` method
- [ ] Create `apps/llm-orchestrator-service/src/domain/research/ports/NotificationSender.ts`
- [ ] Define `sendResearchComplete(userId: string, researchId: string, title: string)` method
- [ ] Export from domain index

## Definition of Done

- [ ] All ports defined
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete port files.
