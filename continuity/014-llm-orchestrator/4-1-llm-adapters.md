# 4-1: LLM Adapters

**Tier:** 4 - LLM Orchestrator Infrastructure
**Status:** Pending

## Context

Wire up LLM adapters from shared packages.

## Problem Statement

Need to connect domain ports to infra-gemini, infra-claude, infra-gpt packages.

## Scope

**In Scope:**
- Create adapter wrappers implementing domain ports
- Configure with appropriate models
- Handle timeout and error cases

**Out of Scope:**
- Package implementations (Tier 1)

## Required Approach

1. Import clients from packages
2. Wrap in adapter implementing `LlmProviderAdapter` port
3. Configure timeout (5 minutes for deep research)

## Step Checklist

- [ ] Create `apps/llm-orchestrator-service/src/infra/llm/geminiAdapter.ts`
- [ ] Create `apps/llm-orchestrator-service/src/infra/llm/claudeAdapter.ts`
- [ ] Create `apps/llm-orchestrator-service/src/infra/llm/gptAdapter.ts`
- [ ] Implement `research()` method for each
- [ ] Handle timeouts and errors
- [ ] Export from infra index

## Definition of Done

- [ ] All adapters implement port interface
- [ ] Error handling is consistent
- [ ] `npm run typecheck` passes

## Verification Commands

```bash
npm run typecheck --workspace=@intexuraos/llm-orchestrator-service
```

## Rollback Plan

Delete adapter files.
